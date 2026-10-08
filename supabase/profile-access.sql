alter table public."Sunday.Wri Tables" enable row level security;

revoke select on public."Sunday.Wri Tables" from anon, authenticated;
grant select ("id", "Full Name", "Poetic Name")
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
