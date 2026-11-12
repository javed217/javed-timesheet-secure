
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

    // Verify account is active.
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return reply({ error: "Unable to verify account status" }, 500);
    }

    if (profile?.is_active !== true) {
      return reply({ error: "Account is inactive" }, 403);
    }

    // Determine the user's actual role from the protected table.
    const { data: roleData, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError) {
      return reply({ error: "Unable to verify permissions" }, 500);
    }

    const isAdmin = roleData?.role === "admin";

    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return reply({ error: "Invalid request body" }, 400);
    }

    const month = String(body.month || "");

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return reply({ error: "Invalid month. Use YYYY-MM." }, 400);
    }

    // Normal users can ONLY export their own records.
    // An admin can export one user or all users.
    let targetUserId = user.id;

    if (isAdmin) {
      const requestedId = String(body.user_id || "all");

      if (requestedId === "all") {
        targetUserId = "all";
      } else {
        const validUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

        if (!validUuid.test(requestedId)) {
          return reply({ error: "Invalid user ID" }, 400);
        }

        targetUserId = requestedId;
      }
    }

    const start = month + "-01";

    const [year, monthNumber] = month.split("-").map(Number);

    const end = new Date(
      Date.UTC(year, monthNumber, 0)
    ).toISOString().slice(0, 10);

    let query = admin
      .from("timesheets")
      .select("work_date, task, hours, day_status, user_id")
      .gte("work_date", start)
      .lte("work_date", end)
      .order("work_date");

    if (targetUserId !== "all") {
      query = query.eq("user_id", targetUserId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Timesheet export error:", error);
      return reply({ error: "Unable to retrieve timesheets" }, 500);
    }

    const ids = [
      ...new Set((data || []).map((row) => row.user_id)),
    ];

    // For an all-users export, include every active profile so each user
    // receives a worksheet even when they have no entries for the month.
    let profilesQuery = admin
      .from("profiles")
      .select("id, full_name");

    if (targetUserId !== "all") {
      profilesQuery = profilesQuery.in("id", ids.length ? ids : [targetUserId]);
    }

    const { data: profiles, error: namesError } = await profilesQuery.order("full_name");

    if (namesError) {
      return reply({ error: "Unable to retrieve resource names" }, 500);
    }

    const names = new Map(
      (profiles || []).map((p) => [p.id, p.full_name])
    );

    const rows = (data || []).map((row) => ({
      user_id: row.user_id,
      work_date: row.work_date,
      resource: names.get(row.user_id) || "Unknown",
      task: row.task,
      hours: row.hours ?? 0,
      day_status: row.day_status || "Working",
    }));

    // Record export in audit log.
    const { error: auditError } = await admin
      .from("audit_logs")
      .insert({
        actor_user_id: user.id,
        action: isAdmin ? "admin_export" : "user_export",
        details: {
          month,
          user_id: targetUserId,
          row_count: rows.length,
        },
      });

    if (auditError) {
      console.error("Export audit logging failed:", auditError);
      return reply({ error: "Unable to record export audit" }, 500);
    }

    const users = (targetUserId === "all" ? profiles || [] : []).map((profile) => ({
      id: profile.id,
      full_name: profile.full_name || "User",
    }));

    return reply({ rows, users });

  } catch (error) {
    console.error("Export function error:", error);
    return reply({ error: "Unexpected server error" }, 500);
  }
});
