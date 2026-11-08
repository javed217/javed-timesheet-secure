# Javed Timesheet

Static GitHub Pages frontend with Supabase Auth, PostgreSQL Row Level Security, protected Edge Functions, and formatted Excel export.

## Website files
- `index.html` — personal monthly timesheet.
- `admin.html` — separate administrator settings page.
- `app.js` — authentication, calendar, KPI calculations, autosave, and exports.
- `styles.css` — responsive navy/white styling and calendar row colors.
- `supabase/migrations/` — database migrations.
- `supabase/functions/` — protected admin functions.

## Important security notes
- The frontend contains only the Supabase project URL and publishable key. A publishable key is designed to be visible in browser code.
- Never put Supabase secret/service-role keys, database passwords, access tokens, or `.env` files in GitHub.
- GitHub Pages is public. Supabase Auth and RLS must protect all timesheet data.
- The `.gitignore` excludes local `node_modules` and `supabase/.temp`.

## Update instructions for the existing Supabase project

The first migration adds `day_status`; the second expands its allowed values. Existing rows are preserved.

1. Open Supabase Dashboard → SQL Editor → New query.
2. If you have NOT already run `202611080001_add_day_status.sql`, run that file first. If you already ran it in the previous setup step, do not run it again.
3. Run `supabase/migrations/202611080002_expand_leave_types.sql`.
4. Confirm the migration reports Success.

The original migration should not be run again on the existing project.

## Deploy the updated admin export function

The existing admin export function already returns `day_status`; no Edge Function redeployment is required for these dashboard-only KPI and leave-selector changes. Keep all existing Edge Function secrets in Supabase and never add them to this folder or GitHub.

## Publish the updated website

Upload/replace these files in the root of the existing GitHub repository:
- `index.html`
- `admin.html` (new)
- `app.js`
- `styles.css`
- `.gitignore`
- `README.md`
- `supabase/migrations/202611080001_add_day_status.sql` (only if not already run)
- `supabase/migrations/202611080002_expand_leave_types.sql`
- `supabase/functions/admin-export/index.ts`

Do not upload `node_modules`, `.git`, or `supabase/.temp`.

GitHub Pages will redeploy automatically after the commit.

## Included behavior

- Resource is displayed/exported as `Javed`.
- KPI cards show resource, monthly hours against a dynamic target (scheduled working days × 8), public holidays with dates/names, working weekdays against total calendar days, and a leave count with leave dates/types.
- Saturday/Sunday classification takes priority over a holiday.
- Weekday holidays display `Holiday - [holiday name]`.
- Personal, emergency and paternity leave can be selected only on normal working weekdays. Leave days are counted separately and do not reduce the scheduled working-day target.
- Excel exports contain only Date, Resource, Task and Hour, use the website row colors, keep the resource name as Javed, and include a total-hours row at the bottom.
- Admin controls are on `admin.html`; the Admin Settings link is shown only to administrators.
- Existing invitation, role management, activation/deactivation, and admin export functions remain in the admin page.

## Calendar holidays currently configured
- 08-Nov-2026 — Diwali Laxmi Pujan (Sunday; therefore shown as Weekend).
- 10-Nov-2026 — Diwali-Balipratipada.
- 24-Nov-2026 — Prakash Gurpurab Sri Guru Nanak Dev.
- 25-Dec-2026 — Christmas.
