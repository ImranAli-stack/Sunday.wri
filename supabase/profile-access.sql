alter table public.profiles
  add column if not exists username text,
  add column if not exists avatar_url text,
  add column if not exists stories_count integer not null default 0,
  add column if not exists followers_count integer not null default 0,
  add column if not exists following_count integer not null default 0,
  add column if not exists total_likes integer not null default 0,
  add column if not exists total_comments integer not null default 0,
  add column if not exists created_at timestamptz not null default timezone('utc'::text, now());

update public.profiles
set username = 'member-' || left(replace(id::text, '-', ''), 12)
where username is null or btrim(username) = '';

update public.profiles
set stories_count = coalesce(stories_count, 0),
    followers_count = coalesce(followers_count, 0),
    following_count = coalesce(following_count, 0),
    total_likes = coalesce(total_likes, 0),
    total_comments = coalesce(total_comments, 0),
    created_at = coalesce(created_at, timezone('utc'::text, now()));

alter table public.profiles
  alter column username set not null,
  alter column stories_count set default 0,
  alter column stories_count set not null,
  alter column followers_count set default 0,
  alter column followers_count set not null,
  alter column following_count set default 0,
  alter column following_count set not null,
  alter column total_likes set default 0,
  alter column total_likes set not null,
  alter column total_comments set default 0,
  alter column total_comments set not null,
  alter column created_at set default timezone('utc'::text, now()),
  alter column created_at set not null;

create unique index if not exists profiles_username_key
  on public.profiles (username);

alter table public.profiles enable row level security;

revoke select on public.profiles from public, anon, authenticated;

do $$
declare
  existing_column_grant record;
  grantee_sql text;
begin
  for existing_column_grant in
    select column_name, grantee
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'profiles'
      and privilege_type = 'SELECT'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  loop
    grantee_sql := case
      when existing_column_grant.grantee = 'PUBLIC' then 'PUBLIC'
      else quote_ident(existing_column_grant.grantee)
    end;
    execute format(
      'revoke select (%I) on table public.profiles from %s',
      existing_column_grant.column_name,
      grantee_sql
    );
  end loop;
end;
$$;

grant select (
  id, username, full_name, bio, avatar_url,
  stories_count, followers_count, following_count, total_likes, total_comments,
  created_at
)
  on public.profiles to anon, authenticated;

drop policy if exists "Anyone can read public profiles"
  on public.profiles;
create policy "Anyone can read public profiles"
  on public.profiles for select
  to anon, authenticated
  using (true);
