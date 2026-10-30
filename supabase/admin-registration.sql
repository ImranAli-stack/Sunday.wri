-- ============================================================================
-- Qalamly (Sunday.wri) — Admin Table & One-Time Registration System with RLS
-- Run this script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/xjdrqktoeodohyoynphg/sql/new
-- ============================================================================

-- 1. Create the `admins` table
create table if not exists public.admins (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'super_admin' check (role in ('super_admin', 'admin', 'moderator')),
  is_active boolean not null default true,
  registered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists admins_email_idx on public.admins (lower(email));
create index if not exists admins_role_idx on public.admins (role);
create index if not exists admins_is_active_idx on public.admins (is_active);

-- 2. Helper functions for One-Time Registration and verification

-- Function 2.1: Check if one-time admin registration is available
-- Returns TRUE if zero active admins exist, FALSE once an initial admin is registered
create or replace function public.is_admin_registration_available()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select not exists (
    select 1 from public.admins where is_active = true
  );
$$;

-- Function 2.2: Helper to check if a user is an active administrator
create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.admins
    where id = user_id and is_active = true
  );
$$;

-- Function 2.3: Atomic One-Time Admin Registration RPC
-- Can only be executed successfully when NO active admin exists yet
create or replace function public.register_initial_admin(admin_full_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  curr_uid uuid;
  curr_email text;
  admin_count integer;
  new_admin record;
begin
  curr_uid := auth.uid();
  if curr_uid is null then
    raise exception 'Unauthorized: Authentication required to register administrator.';
  end if;

  select email into curr_email
  from auth.users
  where id = curr_uid;

  if curr_email is null then
    raise exception 'User not found in authentication directory.';
  end if;

  -- Strictly check if ANY active admin already exists
  select count(*) into admin_count
  from public.admins
  where is_active = true;

  if admin_count > 0 then
    raise exception 'Registration locked: An administrator has already been registered. One-time setup is closed.';
  end if;

  -- Insert the primary administrator
  insert into public.admins (id, email, full_name, role, is_active, registered_at)
  values (
    curr_uid,
    lower(curr_email),
    coalesce(nullif(admin_full_name, ''), split_part(curr_email, '@', 1)),
    'super_admin',
    true,
    now()
  )
  on conflict (id) do update
  set is_active = true,
      role = 'super_admin',
      full_name = coalesce(excluded.full_name, public.admins.full_name)
  returning * into new_admin;

  -- Also update user profile if profiles table exists
  begin
    update public.profiles
    set role = 'both',
        full_name = coalesce(nullif(admin_full_name, ''), full_name)
    where id = curr_uid;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'success', true,
    'message', 'Initial administrator registered successfully. One-time registration is now completed and closed.',
    'admin_id', new_admin.id,
    'email', new_admin.email,
    'role', new_admin.role
  );
end;
$$;

-- 3. Row Level Security (RLS)
alter table public.admins enable row level security;

-- Revoke all default table access from anon and authenticated
revoke all on public.admins from anon, authenticated;

-- Allow authenticated users to select according to RLS policy
grant select on public.admins to authenticated;

-- Grant execution of the security definer functions
grant execute on function public.is_admin_registration_available() to anon, authenticated;
grant execute on function public.is_admin(uuid) to anon, authenticated;
grant execute on function public.register_initial_admin(text) to authenticated;

-- Policy 1: SELECT
-- Admins can read admin records, and any authenticated user can check their own admin status
drop policy if exists "Admins can view admins" on public.admins;
create policy "Admins can view admins"
  on public.admins for select
  to authenticated
  using (
    id = (select auth.uid())
    or public.is_admin((select auth.uid()))
  );

-- Policy 2: INSERT
-- Bootstrap: allow inserting only if zero active admins exist (strictly one-time registration)
-- Post-bootstrap: only existing super_admins can insert new admins
drop policy if exists "Allow one-time initial admin registration or super admin insert" on public.admins;
create policy "Allow one-time initial admin registration or super admin insert"
  on public.admins for insert
  to authenticated
  with check (
    (
      id = (select auth.uid())
      and not exists (select 1 from public.admins where is_active = true)
    )
    or exists (
      select 1 from public.admins
      where id = (select auth.uid())
        and role = 'super_admin'
        and is_active = true
    )
  );

-- Policy 3: UPDATE
-- Super admins can update admin status/roles, or admins can update their own profile name
drop policy if exists "Super admins or self update admins" on public.admins;
create policy "Super admins or self update admins"
  on public.admins for update
  to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.admins
      where id = (select auth.uid())
        and role = 'super_admin'
        and is_active = true
    )
  )
  with check (
    id = (select auth.uid())
    or exists (
      select 1 from public.admins
      where id = (select auth.uid())
        and role = 'super_admin'
        and is_active = true
    )
  );

-- Policy 4: DELETE
-- Only super admins can remove admins, and they cannot delete themselves
drop policy if exists "Super admins can delete other admins" on public.admins;
create policy "Super admins can delete other admins"
  on public.admins for delete
  to authenticated
  using (
    exists (
      select 1 from public.admins
      where id = (select auth.uid())
        and role = 'super_admin'
        and is_active = true
    )
    and id <> (select auth.uid())
  );

-- 4. Security Hardening: Revoke and drop unauthenticated password reset backdoors
drop function if exists public.reset_admin_password(text, text);
