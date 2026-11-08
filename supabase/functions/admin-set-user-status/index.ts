
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
    const active = body?.is_active;

    const validUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!validUuid.test(target) || typeof active !== "boolean") {
      return reply({ error: "Invalid user ID or account status" }, 400);
    }

    if (target === user.id && !active) {
      return reply({
        error: "You cannot deactivate your own administrator account.",
      }, 400);
    }

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

    const { data: targetRole, error: targetRoleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", target)
      .maybeSingle();

    if (targetRoleError) {
      return reply({ error: "Unable to verify target role" }, 500);
    }

    // Never deactivate the last active administrator.
    if (
      targetRole?.role === "admin" &&
      !active &&
      targetProfile.is_active
    ) {
      const { data: admins, error: adminsError } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");

      if (adminsError) {
        return reply({ error: "Unable to verify active administrators" }, 500);
      }

      const adminIds = (admins || []).map((item) => item.user_id);

      const { data: activeProfiles, error: activeError } = adminIds.length
        ? await admin
            .from("profiles")
            .select("id")
            .in("id", adminIds)
            .eq("is_active", true)
        : { data: [], error: null };

      if (activeError) {
        return reply({ error: "Unable to verify active administrators" }, 500);
      }

      if ((activeProfiles || []).length <= 1) {
        return reply({
          error: "Cannot deactivate the last active administrator.",
        }, 400);
      }
    }

    // Update authentication access first.
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(
      target,
      { ban_duration: active ? "none" : "876000h" }
    );

    if (authUpdateError) {
      return reply({ error: "Unable to update authentication status" }, 400);
    }

    // Update profile status. Roll back the auth ban if this fails.
    const { error: profileUpdateError } = await admin
      .from("profiles")
      .update({ is_active: active })
      .eq("id", target);

    if (profileUpdateError) {
      await admin.auth.admin.updateUserById(target, {
        ban_duration: targetProfile.is_active ? "none" : "876000h",
      });

      return reply({ error: "Unable to update profile status" }, 500);
    }

    const { error: auditError } = await admin
      .from("audit_logs")
      .insert({
        actor_user_id: user.id,
        action: active ? "reactivate_user" : "deactivate_user",
        target_user_id: target,
      });

    if (auditError) {
      console.error("Account status audit failed:", auditError);
    }

    return reply({
      message: active
        ? "Account reactivated."
        : "Account deactivated.",
    });

  } catch (error) {
    console.error("User status function error:", error);
    return reply({ error: "Unexpected server error" }, 500);
  }
});
