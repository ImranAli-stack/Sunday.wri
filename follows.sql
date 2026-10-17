create table if not exists public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self_follow check (follower_id <> following_id)
);

alter table public.follows enable row level security;

revoke all on public.follows from anon, authenticated;
grant select, insert, delete on public.follows to authenticated;

drop policy if exists "Users can read their follows" on public.follows;
create policy "Users can read their follows"
  on public.follows for select
  to authenticated
  using (
    follower_id = (select auth.uid())
    or following_id = (select auth.uid())
  );

drop policy if exists "Users can follow others" on public.follows;
create policy "Users can follow others"
  on public.follows for insert
  to authenticated
  with check (
    follower_id = (select auth.uid())
    and following_id <> (select auth.uid())
  );

drop policy if exists "Users can unfollow others" on public.follows;
create policy "Users can unfollow others"
  on public.follows for delete
  to authenticated
  using (follower_id = (select auth.uid()));
