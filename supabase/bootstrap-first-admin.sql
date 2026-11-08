-- Run this ONCE after creating your own account via Supabase Dashboard > Authentication > Users.
-- Replace the email below with the email address you used for your own account.
-- Do not run this with a public or shared email address.
insert into public.user_roles(user_id, role)
select id, 'admin' from auth.users where lower(email)=lower('YOUR_ADMIN_EMAIL@example.com')
on conflict (user_id) do update set role='admin';

-- Verify that exactly your account was promoted:
select p.full_name,p.email,r.role,p.is_active
from public.profiles p join public.user_roles r on r.user_id=p.id
where lower(p.email)=lower('YOUR_ADMIN_EMAIL@example.com');
