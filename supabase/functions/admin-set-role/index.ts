
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
      error: authError,
    } = await caller.auth.getUser();

    if (authError || !user) {
      return reply({ error: "Invalid session" }, 401);
    }

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Verify the requesting administrator.
    const { data: myProfile, error: myProfileError } = await admin
      .from("profiles")
      .select("is_active")
      .eq("id", user.id)
      .maybeSingle();

    const { data: myRole, error: myRoleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (myProfileError || myRoleError) {
      return reply({ error: "Unable to verify administrator access" }, 500);
    }

    if (myRole?.role !== "admin" || myProfile?.is_active !== true) {
      return reply({ error: "Active administrator permission required" }, 403);
    }

    const body = await req.json().catch(() => null);

    const target = String(body?.user_id || "");
    const newRole = body?.role;

    const validUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (
      !validUuid.test(target) ||
      !["admin", "user"].includes(newRole)
    ) {
      return reply({ error: "Invalid user ID or role" }, 400);
    }

    if (target === user.id && newRole !== "admin") {
      return reply({
        error: "You cannot remove your own administrator role.",
      }, 400);
    }

    // Verify target account.
    const { data: targetProfile, error: targetProfileError } = await admin
      .from("profiles")
      .select("id, is_active")
      .eq("id", target)
      .maybeSingle();

    if (targetProfileError) {
      return reply({ error: "Unable to verify target account" }, 500);
    }

    if (!targetProfile) {
      return reply({ error: "User account not found" }, 404);
    }

    if (targetProfile.is_active !== true) {
      return reply({ error: "Cannot change the role of an inactive account" }, 400);
    }

    const { data: targetRole, error: targetRoleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", target)
      .maybeSingle();

    if (targetRoleError) {
      return reply({ error: "Unable to verify target role" }, 500);
    }

    if (!targetRole) {
      return reply({ error: "User role not found" }, 404);
    }

    // Protect the last active administrator.
    if (targetRole.role === "admin" && newRole === "user") {
      const { data: admins, error: adminsError } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");

      if (adminsError) {
        return reply({ error: "Unable to verify administrators" }, 500);
      }

      const adminIds = (admins || []).map((item) => item.user_id);

      const { data: activeAdmins, error: activeError } = adminIds.length
        ? await admin
            .from("profiles")
            .select("id")
            .in("id", adminIds)
            .eq("is_active", true)
        : { data: [], error: null };

      if (activeError) {
        return reply({ error: "Unable to verify active administrators" }, 500);
      }

      if ((activeAdmins || []).length <= 1) {
        return reply({
          error: "Cannot demote the last active administrator.",
        }, 400);
      }
    }

    const { error: updateError } = await admin
      .from("user_roles")
      .update({ role: newRole })
      .eq("user_id", target);

    if (updateError) {
      return reply({ error: "Unable to update user role" }, 500);
    }

    const { error: auditError } = await admin
      .from("audit_logs")
      .insert({
        actor_user_id: user.id,
        action: "change_role",
        target_user_id: target,
        details: { role: newRole },
      });

    if (auditError) {
      console.error("Role change audit failed:", auditError);
    }

    return reply({
      message: `User role changed to ${newRole}.`,
    });

  } catch (error) {
    console.error("Role function error:", error);
    return reply({ error: "Unexpected server error" }, 500);
  }
});
