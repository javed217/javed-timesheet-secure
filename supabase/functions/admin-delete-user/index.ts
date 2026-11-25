import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    const anon = publishableKeys.default;
    const service = secretKeys.default;
    if (!url || !anon || !service) return reply({ error: "Server configuration is incomplete" }, 500);

    const authorization = req.headers.get("Authorization");
    if (!authorization) return reply({ error: "Authentication required" }, 401);
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return reply({ error: "Invalid session" }, 401);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const [{ data: myProfile, error: profileError }, { data: myRole, error: roleError }] = await Promise.all([
      admin.from("profiles").select("is_active").eq("id", user.id).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
    ]);
    if (profileError || roleError) return reply({ error: "Unable to verify administrator access" }, 500);
    if (myRole?.role !== "admin" || myProfile?.is_active !== true) return reply({ error: "Active administrator permission required" }, 403);

    const body = await req.json().catch(() => null);
    const target = String(body?.user_id || "");
    const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!validUuid.test(target)) return reply({ error: "Invalid user ID" }, 400);
    if (target === user.id) return reply({ error: "You cannot remove your own account" }, 400);

    const [{ data: targetProfile, error: targetProfileError }, { data: targetRole, error: targetRoleError }] = await Promise.all([
      admin.from("profiles").select("id,full_name,email,is_active").eq("id", target).maybeSingle(),
      admin.from("user_roles").select("role").eq("user_id", target).maybeSingle(),
    ]);
    if (targetProfileError || targetRoleError) return reply({ error: "Unable to verify target account" }, 500);
    if (!targetProfile) return reply({ error: "User account not found" }, 404);

    if (targetRole?.role === "admin" && targetProfile.is_active) {
      const { data: adminRows, error: adminsError } = await admin.from("user_roles").select("user_id").eq("role", "admin");
      if (adminsError) return reply({ error: "Unable to verify active administrators" }, 500);
      const adminIds = (adminRows || []).map((row) => row.user_id);
      const { data: activeAdmins, error: activeError } = adminIds.length
        ? await admin.from("profiles").select("id").in("id", adminIds).eq("is_active", true)
        : { data: [], error: null };
      if (activeError) return reply({ error: "Unable to verify active administrators" }, 500);
      if ((activeAdmins || []).length <= 1) return reply({ error: "Cannot remove the last active administrator. Promote another administrator first." }, 400);
    }

    const { error: auditError } = await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "remove_user",
      target_user_id: target,
      details: { email: targetProfile.email, full_name: targetProfile.full_name },
    });
    if (auditError) console.error("User removal audit failed:", auditError);

    // auth.users deletion cascades to profiles, roles and timesheets by schema design.
    const { error: deleteError } = await admin.auth.admin.deleteUser(target);
    if (deleteError) return reply({ error: "Unable to permanently remove user account" }, 500);
    return reply({ message: `${targetProfile.full_name || targetProfile.email} and their saved timesheet data were permanently removed.` });
  } catch (error) {
    console.error("User deletion function error:", error);
    return reply({ error: "Unexpected server error" }, 500);
  }
});
