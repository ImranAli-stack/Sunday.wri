-- ============================================================================
-- Qalamly (Sunday.wri) — Complete Schema Alignment, Triggers & Grants
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/xjdrqktoeodohyoynphg/sql/new
-- ============================================================================

-- 1. Drop ALL existing custom triggers on `auth.users` (removes legacy broken triggers)
do $$
declare
  trig record;
begin
  for trig in
    select tgname
    from pg_trigger t
    join pg_class c on t.tgrelid = c.oid
    join pg_namespace n on c.relnamespace = n.oid
    where n.nspname = 'auth'
      and c.relname = 'users'
      and not t.tgisinternal
  loop
    execute format('drop trigger if exists %I on auth.users', trig.tgname);
  end loop;
end;
$$;

-- 2. Align `public.profiles` columns & permissions with frontend JS (`js/app.js` & `admin-dashboard/app.js`)
alter table public.profiles
  add column if not exists full_name text default 'Anonymous Writer',
  add column if not exists peotic_name text,
  add column if not exists email text,
  add column if not exists username text,
  add column if not exists bio text,
  add column if not exists avatar_url text,
  add column if not exists role text default 'both',
  add column if not exists stories_count integer default 0,
  add column if not exists followers_count integer default 0,
  add column if not exists following_count integer default 0,
  add column if not exists total_likes integer default 0,
  add column if not exists total_comments integer default 0,
  add column if not exists created_at timestamptz default now();

do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    join pg_namespace n on t.relnamespace = n.oid
    where n.nspname = 'public'
      and t.relname = 'profiles'
      and c.contype = 'c'
  loop
    execute format('alter table public.profiles drop constraint if exists %I', con.conname);
  end loop;
end;
$$;

alter table public.profiles
  alter column peotic_name drop not null,
  alter column email drop not null,
  alter column username drop not null,
  alter column full_name drop not null,
  alter column role drop not null,
  alter column full_name set default 'Anonymous Writer',
  alter column role set default 'both',
  alter column stories_count set default 0,
  alter column followers_count set default 0,
  alter column following_count set default 0,
  alter column total_likes set default 0,
  alter column total_comments set default 0;

grant select on public.profiles to anon, authenticated;
grant insert, update, delete on public.profiles to authenticated;

-- 3. Align `public.notifications` columns (`type`, `actor_id`, `post_id`, `message`, `is_read`)
alter table public.notifications
  add column if not exists actor_id uuid references auth.users (id) on delete set null,
  add column if not exists post_id uuid,
  add column if not exists type text default 'general',
  add column if not exists message text,
  add column if not exists is_read boolean not null default false;

grant select, insert, update, delete on public.notifications to authenticated;

-- 4. Ensure `public.posts` has `image_path` and `language`
alter table public.posts
  add column if not exists image_path text,
  add column if not exists language text not null default 'English';

-- 5. Create a single, fault-tolerant trigger on `auth.users` that NEVER blocks user signup
create or replace function public.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  display_name text;
  pen_name text;
  clean_handle text;
  user_role text;
begin
  display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'Full_Name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    split_part(new.email, '@', 1),
    'Anonymous Writer'
  );

  pen_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'peotic_name', ''),
    nullif(new.raw_user_meta_data ->> 'poetic_name', ''),
    nullif(new.raw_user_meta_data ->> 'Poetic_Name', ''),
    display_name
  );

  clean_handle := coalesce(
    nullif(trim(both '-' from regexp_replace(lower(pen_name), '[^a-z0-9]+', '-', 'g')), ''),
    'writer'
  ) || '-' || left(replace(new.id::text, '-', ''), 6);

  user_role := case
    when lower(coalesce(new.raw_user_meta_data ->> 'role', '')) in ('reader', 'writer', 'both')
      then lower(new.raw_user_meta_data ->> 'role')
    when lower(coalesce(new.raw_user_meta_data ->> 'Writer_o_reader', '')) in ('reader', 'writer', 'both')
      then lower(new.raw_user_meta_data ->> 'Writer_o_reader')
    else 'both'
  end;

  begin
    insert into public.profiles (
      id, username, full_name, peotic_name, email, role,
      stories_count, followers_count, following_count, total_likes, total_comments
    )
    values (
      new.id,
      clean_handle,
      display_name,
      pen_name,
      coalesce(new.email, ''),
      user_role,
      0, 0, 0, 0, 0
    )
    on conflict (id) do update
    set full_name = excluded.full_name,
        peotic_name = excluded.peotic_name,
        email = coalesce(public.profiles.email, excluded.email);
  exception when others then
    -- Never fail auth.users signup even if profile row has a conflict
    null;
  end;

  return new;
end;
$$;

create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_auth_user();

-- 6. Direct Password Recovery RPCs (Allows Admin & User password reset even when Supabase SMTP is rate-limited)
-- Security Hardening: Revoke and drop unauthenticated password reset backdoors
drop function if exists public.reset_admin_password(text, text);
drop function if exists public.reset_user_password(text, text);
