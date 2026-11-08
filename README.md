# Javed Timesheet — secure starter package

A static website for GitHub Pages with Supabase Auth, PostgreSQL Row Level Security (RLS), admin Edge Functions, and Excel export.

## Included

- `index.html`, `styles.css`, `app.js` — navy/white responsive website.
- `supabase/migrations/202611070001_secure_timesheet.sql` — tables, constraints, RLS policies, role helpers, auth trigger and admin directory view.
- `supabase/bootstrap-first-admin.sql` — one-time first-admin promotion.
- `supabase/functions/admin-invite` — invitation-only account creation.
- `supabase/functions/admin-export` — admin-only individual/all-user export data.
- `supabase/functions/admin-set-user-status` — activate/deactivate accounts.
- `supabase/functions/admin-set-role` — promote/demote administrators.
- `supabase/config.toml` — function JWT verification settings.

## Before you start

You need a GitHub account and a Supabase account. Do not put any secret key, database password, service-role key, or `.env` file in this repository. The browser only receives the Supabase project URL and publishable key. The Edge Functions use the server-side `SUPABASE_SERVICE_ROLE_KEY` environment variable supplied by Supabase.

## Step 1 — Create a Supabase project

1. Sign in at https://supabase.com/dashboard.
2. Create a new project and choose a strong database password. Store it in a password manager.
3. Wait for the database to finish provisioning.
4. Open Project Settings → API (or API Keys). Copy the Project URL and the **publishable** key (`sb_publishable_...`). Do not copy the secret key into the website.

## Step 2 — Create the database and security policies

1. In Supabase, open SQL Editor → New query.
2. Open `supabase/migrations/202611070001_secure_timesheet.sql` from this package.
3. Copy the full SQL into the editor and run it.
4. Check Table Editor: `profiles`, `user_roles`, `timesheets`, and `audit_logs` should exist.
5. Confirm RLS is enabled on all four tables. Do not disable RLS to troubleshoot an error.

## Step 3 — Create your first account and make it admin

1. In Supabase → Authentication → Users, create your own user using your email and a strong unique password. If the dashboard's create-user flow offers email confirmation, confirm it.
2. In SQL Editor, open `supabase/bootstrap-first-admin.sql`.
3. Replace both occurrences of `YOUR_ADMIN_EMAIL@example.com` with your own account email, then run it once.
4. Verify the query result shows your email, `admin`, and `true`.
5. Keep this admin account protected with MFA. Do not expose the bootstrap SQL or run it for ordinary users.

## Step 4 — Configure the website

1. Open `app.js`.
2. Replace `YOUR_SUPABASE_PROJECT_URL` with the Project URL.
3. Replace `YOUR_SUPABASE_PUBLISHABLE_KEY` with the publishable key.
4. Save the file. These two values are expected to be visible in browser code; they are not secret credentials.
5. Never put a secret key, service-role key, database password, or admin password in `app.js`, HTML, CSS, or GitHub.

## Step 5 — Deploy the Edge Functions

The included Edge Functions perform privileged operations. They check the caller's signed-in user and active admin role before using the service credential.

1. Install the Supabase CLI using the official instructions: https://supabase.com/docs/guides/cli.
2. Open a terminal in this project folder.
3. Run `supabase login`.
4. Link your project: `supabase link --project-ref YOUR_SUPABASE_PROJECT_REF`.
5. Check the project's Edge Function secrets in Supabase Dashboard → Edge Functions → Secrets. Supabase projects normally provide `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to functions. Confirm the service-role environment variable is present in the function runtime. Never paste it into this repository.
6. Deploy each function:
   - `supabase functions deploy admin-invite`
   - `supabase functions deploy admin-export`
   - `supabase functions deploy admin-set-user-status`
   - `supabase functions deploy admin-set-role`
7. Leave JWT verification enabled. The included `config.toml` sets `verify_jwt = true` for each function.

If your project uses the newer secret API key and does not expose the legacy `SUPABASE_SERVICE_ROLE_KEY` runtime variable, adapt the server-side function initialization to the secret key supported by your project. Keep that key in Edge Function secrets only. Never add it to browser code.

## Step 6 — Configure Auth email and redirect URLs

1. Supabase → Authentication → URL Configuration.
2. Set Site URL to your eventual GitHub Pages URL, e.g. `https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPOSITORY/`.
3. Add that URL to the allowed Redirect URLs.
4. Configure SMTP/email delivery for reliable invitation emails. For production, use a trusted SMTP provider and verify your sending domain.
5. Keep public sign-ups disabled. Accounts should be created through the admin invitation function only.
6. Configure password policy and enable/require MFA for administrator accounts.

## Step 7 — Publish on GitHub Pages

1. Create a new GitHub repository. For private timesheet source code, set the repository to **Private**; GitHub Pages availability for private repositories depends on your GitHub plan/organization settings. The deployed site itself is still publicly reachable, so database security is essential.
2. Upload `index.html`, `styles.css`, `app.js`, and the `supabase` folder to the repository root.
3. Do not upload `.env`, passwords, service-role keys, database dumps, or secrets.
4. GitHub repository → Settings → Pages → Deploy from a branch → `main` → `/ (root)` → Save.
5. Wait for the Pages deployment and open the published URL.
6. Add the final Pages URL to Supabase Auth redirect allow-list.

## Step 8 — Invite users and add more admins

1. Sign in as the first admin.
2. In Admin dashboard, enter a user's full name and email and send the invitation.
3. The invited user follows the email link, sets their password, and signs in.
4. To add another admin, use the User accounts list and select **Make admin**. This calls a protected Edge Function. The new admin should sign out and back in to refresh their session.
5. Admins can deactivate/reactivate accounts. The last admin cannot be deactivated or demoted by the included functions.

## Step 9 — Test security before using real timesheets

Use two test users, User A and User B, plus the admin account.

- User A can select, insert, update and delete only User A's timesheet rows.
- User A cannot read User B's rows even if User A manually changes a user ID in a request.
- User A cannot invoke admin-invite, admin-export, admin-set-user-status, or admin-set-role successfully.
- User B cannot download User A's timesheet.
- Admin can view all records and export an individual user or all users for a selected month.
- Anonymous requests cannot read any timesheet rows.
- A deactivated account is denied by the website and by the timesheet RLS policies.

Run Supabase database policy tests before production where possible: https://supabase.com/docs/guides/database/testing.

## Important notes / current starter limitations

- This is a starter implementation. Review and test it in a separate Supabase project before using real employee data.
- The sample holiday list currently includes Nov 10, Nov 24 and Dec 25, 2026. Weekend classification takes priority over holidays. Add/maintain future holidays in `app.js` or move them into a protected holidays table for admin editing.
- Personal leave selection and the final formatted Excel template from your supplied workbook are not yet implemented in this starter.
- The Excel export currently contains Date, Resource, Task and Hour columns. Styling to exactly match the supplied workbook can be added after the database and access rules pass testing.
- A public GitHub Pages URL is not a private website. Authentication, RLS, server-side authorization and safe key handling protect the data.
- No system is impossible to hack. Keep dependencies updated, use MFA for admins, review audit logs, back up the database, and run security tests before launch.
