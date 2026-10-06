create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  author_name text not null,
  content text not null check (char_length(trim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists comments_post_created_at_idx
  on public.comments (post_id, created_at);

alter table public.comments enable row level security;

revoke all on public.comments from anon, authenticated;
grant select on public.comments to anon, authenticated;
grant insert, delete on public.comments to authenticated;

drop policy if exists "Anyone can read comments on published posts" on public.comments;
create policy "Anyone can read comments on published posts"
  on public.comments for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.posts
      where posts.id = comments.post_id
        and posts.status = 'published'
    )
  );

drop policy if exists "Authenticated users can comment on published posts" on public.comments;
create policy "Authenticated users can comment on published posts"
  on public.comments for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.posts
      where posts.id = comments.post_id
        and posts.status = 'published'
    )
  );

drop policy if exists "Users can delete their own comments" on public.comments;
create policy "Users can delete their own comments"
  on public.comments for delete
  to authenticated
  using (user_id = (select auth.uid()));
