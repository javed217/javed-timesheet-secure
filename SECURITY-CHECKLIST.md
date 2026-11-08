# Pre-launch security checklist

- [ ] The first admin is assigned only by the one-time SQL bootstrap after the owner's account exists.
- [ ] Public sign-up is disabled; invitations are admin-only.
- [ ] All four database tables have RLS enabled.
- [ ] Anonymous role has no table grants.
- [ ] No secret/service-role key or database password exists in the GitHub repository or browser source.
- [ ] Edge Functions require JWT verification and independently check active admin role.
- [ ] Admin MFA is enabled and tested.
- [ ] Test User A cannot read, edit or export User B's timesheet.
- [ ] Test User A cannot call any admin Edge Function successfully.
- [ ] Admin can export one user's month and all users' month.
- [ ] Deactivated user cannot access the website or timesheet rows.
- [ ] Email invitation redirect URLs point only to the intended site.
- [ ] Database backup and restore process is tested.
- [ ] Dependency versions/CDN scripts are reviewed and pinned before production.
