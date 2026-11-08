-- Javed Timesheet secure schema. Run in Supabase SQL Editor or via Supabase CLI.
create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 100),
  email text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz not null default now()
);

create table if not exists public.timesheets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  task text not null default '' check (char_length(task) <= 1000),
  hours numeric(5,2) null check (hours is null or (hours >= 0 and hours <= 24)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, work_date)
);
create index if not exists timesheets_user_date_idx on public.timesheets(user_id, work_date);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.user_roles r
  where r.user_id = (select auth.uid()) and r.role = 'admin'
); $$;
revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select r.role from public.user_roles r where r.user_id = (select auth.uid())), 'user'); $$;
revoke all on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.timesheets enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.profiles, public.user_roles, public.timesheets, public.audit_logs from anon, authenticated;
grant select on public.profiles, public.user_roles to authenticated;
grant select, insert, update, delete on public.timesheets to authenticated;

-- Profiles are readable only by the account owner or an admin. Profile writes are backend-only.
drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles for select to authenticated
using ((select auth.uid()) = id or (select private.is_admin()));

-- Roles can be read by the owner (for diagnostics) or admins. Client role changes are never allowed.
drop policy if exists roles_read_self_or_admin on public.user_roles;
create policy roles_read_self_or_admin on public.user_roles for select to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()));

-- Every user can operate only on their own records. Admins can operate on all records.
drop policy if exists timesheets_select_owner_admin on public.timesheets;
create policy timesheets_select_owner_admin on public.timesheets for select to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()));
drop policy if exists timesheets_insert_owner_admin on public.timesheets;
create policy timesheets_insert_owner_admin on public.timesheets for insert to authenticated
with check ((select auth.uid()) = user_id or (select private.is_admin()));
drop policy if exists timesheets_update_owner_admin on public.timesheets;
create policy timesheets_update_owner_admin on public.timesheets for update to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()))
with check ((select auth.uid()) = user_id or (select private.is_admin()));
drop policy if exists timesheets_delete_owner_admin on public.timesheets;
create policy timesheets_delete_owner_admin on public.timesheets for delete to authenticated
using ((select auth.uid()) = user_id or (select private.is_admin()));

-- Audit logs are never exposed to ordinary users. Backend functions write with service credentials.
revoke all on public.audit_logs from anon, authenticated;

-- Admin directory view uses invoker permissions so underlying RLS remains effective.
create or replace view public.admin_user_directory with (security_invoker = true) as
select p.id, p.full_name, p.email, p.is_active, coalesce(r.role,'user') as role
from public.profiles p left join public.user_roles r on r.user_id = p.id;
revoke all on public.admin_user_directory from anon, authenticated;
grant select on public.admin_user_directory to authenticated;
-- The view's underlying profiles/roles RLS ensures only admins can see the full directory.

-- Auto-create a normal role and profile for invited/new auth users. Edge function upserts profile name.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email)
  on conflict (id) do update set email=excluded.email, updated_at=now();
  insert into public.user_roles(user_id, role) values(new.id,'user') on conflict(user_id) do nothing;
  return new;
end; $$;
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

-- Update timestamp trigger.
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute procedure public.touch_updated_at();
drop trigger if exists timesheets_touch_updated_at on public.timesheets;
create trigger timesheets_touch_updated_at before update on public.timesheets for each row execute procedure public.touch_updated_at();

-- Require active accounts in all timesheet policies, even if an old JWT remains valid.
create or replace function private.is_active_account()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_active=true); $$;
revoke all on function private.is_active_account() from public, anon;
grant execute on function private.is_active_account() to authenticated;
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
 select 1 from public.user_roles r join public.profiles p on p.id=r.user_id
 where r.user_id=(select auth.uid()) and r.role='admin' and p.is_active=true
); $$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

drop policy if exists timesheets_select_owner_admin on public.timesheets;
create policy timesheets_select_owner_admin on public.timesheets for select to authenticated
using ((select private.is_active_account()) and ((select auth.uid())=user_id or (select private.is_admin())));
drop policy if exists timesheets_insert_owner_admin on public.timesheets;
create policy timesheets_insert_owner_admin on public.timesheets for insert to authenticated
with check ((select private.is_active_account()) and ((select auth.uid())=user_id or (select private.is_admin())));
drop policy if exists timesheets_update_owner_admin on public.timesheets;
create policy timesheets_update_owner_admin on public.timesheets for update to authenticated
using ((select private.is_active_account()) and ((select auth.uid())=user_id or (select private.is_admin())))
with check ((select private.is_active_account()) and ((select auth.uid())=user_id or (select private.is_admin())));
drop policy if exists timesheets_delete_owner_admin on public.timesheets;
create policy timesheets_delete_owner_admin on public.timesheets for delete to authenticated
using ((select private.is_active_account()) and ((select auth.uid())=user_id or (select private.is_admin())));
