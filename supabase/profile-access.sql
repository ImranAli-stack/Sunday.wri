alter table public."Sunday.Wri Tables"
  add column if not exists "Bio" text,
  add column if not exists "Avatar URL" text;

alter table public."Sunday.Wri Tables" enable row level security;

revoke select on public."Sunday.Wri Tables" from public, anon, authenticated;

do $$
declare
  existing_column_grant record;
  grantee_sql text;
begin
  for existing_column_grant in
    select column_name, grantee
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'Sunday.Wri Tables'
      and privilege_type = 'SELECT'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  loop
    grantee_sql := case
      when existing_column_grant.grantee = 'PUBLIC' then 'PUBLIC'
      else quote_ident(existing_column_grant.grantee)
    end;
    execute format(
      'revoke select (%I) on table public."Sunday.Wri Tables" from %s',
      existing_column_grant.column_name,
      grantee_sql
    );
  end loop;
end;
$$;

grant select ("id", "Full Name", "Poetic Name", "Avatar URL", "Bio")
  on public."Sunday.Wri Tables" to anon, authenticated;
grant update ("Full Name") on public."Sunday.Wri Tables" to authenticated;

drop policy if exists "Anyone can read public writer profiles"
  on public."Sunday.Wri Tables";
create policy "Anyone can read public writer profiles"
  on public."Sunday.Wri Tables" for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can update their own writer profile"
  on public."Sunday.Wri Tables";
create policy "Users can update their own writer profile"
  on public."Sunday.Wri Tables" for update
  to authenticated
  using ((select auth.uid())::text = id::text)
  with check ((select auth.uid())::text = id::text);

drop policy if exists "Restrict writer profile updates to the owner"
  on public."Sunday.Wri Tables";
create policy "Restrict writer profile updates to the owner"
  on public."Sunday.Wri Tables" as restrictive for update
  to authenticated
  using ((select auth.uid())::text = id::text)
  with check ((select auth.uid())::text = id::text);
