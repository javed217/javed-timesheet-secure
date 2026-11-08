
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return reply({ error: "Method not allowed" }, 405);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishableKeys = JSON.parse(
  Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}"
);

const secretKeys = JSON.parse(
  Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"
);

const anon = publishableKeys.default;
const service = secretKeys.default;

    if (!url || !anon || !service) {
      return reply({ error: "Server configuration is incomplete" }, 500);
    }

    const auth = req.headers.get("Authorization");

    if (!auth) {
      return reply({ error: "Authentication required" }, 401);
    }

    const caller = createClient(url, anon, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userErr,
    } = await caller.auth.getUser();

    if (userErr || !user) {
      return reply({ error: "Invalid session" }, 401);
    }

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: role, error: roleErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (roleErr || profileErr) {
      return reply({ error: "Unable to verify administrator access" }, 500);
    }

    if (role?.role !== "admin" || profile?.is_active !== true) {
      return reply({ error: "Administrator permission required" }, 403);
    }

    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return reply({ error: "Invalid request body" }, 400);
    }

    const email = String(body.email || "").trim().toLowerCase();
    const full_name = String(body.full_name || "").trim();

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !full_name ||
      full_name.length > 100
    ) {
      return reply({ error: "Enter a valid email and name" }, 400);
    }

    const { data, error } = await admin.auth.admin.inviteUserByEmail(
      email,
      { data: { full_name } }
    );

    if (error) {
      return reply({ error: error.message }, 400);
    }

    if (data.user) {
      const { error: profileError } = await admin
        .from("profiles")
        .upsert({
          id: data.user.id,
          full_name,
          email,
          is_active: true,
        });

      if (profileError) {
        return reply({ error: "User invited, but profile setup failed" }, 500);
      }

      const { error: roleError } = await admin
        .from("user_roles")
        .upsert({
          user_id: data.user.id,
          role: "user",
        });

      if (roleError) {
        return reply({ error: "User invited, but role setup failed" }, 500);
      }

      await admin.from("audit_logs").insert({
        actor_user_id: user.id,
        action: "invite_user",
        target_user_id: data.user.id,
        details: { email },
      });
    }

    return reply({ message: "Invitation sent to " + email });
  } catch (error) {
    console.error("Invitation function error:", error);
    return reply({ error: "Unexpected server error" }, 500);
  }
});
