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

grant select (id, full_name, bio)
  on public.profiles to anon, authenticated;

drop policy if exists "Anyone can read public profiles"
  on public.profiles;
create policy "Anyone can read public profiles"
  on public.profiles for select
  to anon, authenticated
  using (true);
