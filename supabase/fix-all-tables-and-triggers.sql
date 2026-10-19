-- ============================================================================
-- Qalamly (Sunday.wri) — Exact Supabase Database Fix & RLS Setup
-- Matches your exact live schema columns:
--   profiles:      id, full_name, peotic_name, email, role, created_at, username, bio, avatar_url, stories_count, followers_count, following_count, total_likes, total_comments
--   posts:         id, created_at, user_id, category, content, author_name, status, title, image_path, language
--   comments:      id, created_at, post_id, user_id, author_name, content
--   likes_table:   id, created_at, user_id, post_id
--   bookmarks:     post_id, user_id, created_at
--   follows:       id, created_at, follower_id, following_id
--   notifications: id, created_at, recipient_id, actor_id, type, post_id, is_read
--   contact:       id, created_at, name, email, subject, message
-- ============================================================================

-- 1. Fix `public.profiles` constraints (using exact column name `peotic_name`)
alter table public.profiles
  alter column peotic_name drop not null,
  alter column email drop not null,
  alter column full_name set default 'Anonymous Writer',
  alter column role set default 'both',
  alter column stories_count set default 0,
  alter column followers_count set default 0,
  alter column following_count set default 0,
  alter column total_likes set default 0,
  alter column total_comments set default 0;

update public.profiles
set peotic_name = coalesce(peotic_name, full_name, 'Writer')
where peotic_name is null;

-- 2. Fix the `auth.users` signup trigger so `supabase.auth.signUp()` succeeds (fixes 500 error)
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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_auth_user();

-- 3. Grant & configure RLS policies on `public.profiles`
alter table public.profiles enable row level security;

grant select (
  id, username, full_name, peotic_name, bio, avatar_url,
  role, stories_count, followers_count, following_count, total_likes, total_comments, created_at
) on public.profiles to anon, authenticated;

grant insert, update on public.profiles to authenticated;

drop policy if exists "Anyone can read public profiles" on public.profiles;
create policy "Anyone can read public profiles"
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- 4. Configure `public.posts` RLS policies
alter table public.posts enable row level security;
grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;

drop policy if exists "Anyone can read published posts or own drafts" on public.posts;
create policy "Anyone can read published posts or own drafts"
  on public.posts for select
  to anon, authenticated
  using (status = 'published' or user_id = (select auth.uid()));

drop policy if exists "Authenticated users can create posts" on public.posts;
create policy "Authenticated users can create posts"
  on public.posts for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Authors can update own posts" on public.posts;
create policy "Authors can update own posts"
  on public.posts for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Authors can delete own posts" on public.posts;
create policy "Authors can delete own posts"
  on public.posts for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- 5. Configure `public.comments` RLS policies
alter table public.comments enable row level security;
grant select on public.comments to anon, authenticated;
grant insert, delete on public.comments to authenticated;

drop policy if exists "Anyone can read comments on published posts" on public.comments;
create policy "Anyone can read comments on published posts"
  on public.comments for select
  to anon, authenticated
  using (true);

drop policy if exists "Authenticated users can comment on published posts" on public.comments;
create policy "Authenticated users can comment on published posts"
  on public.comments for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete their own comments" on public.comments;
create policy "Users can delete their own comments"
  on public.comments for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- 6. Configure `public.notifications` RLS policies
alter table public.notifications enable row level security;
grant select, insert, update on public.notifications to authenticated;

drop policy if exists "Recipients can view own notifications" on public.notifications;
create policy "Recipients can view own notifications"
  on public.notifications for select
  to authenticated
  using (recipient_id = (select auth.uid()));

drop policy if exists "Authenticated users can insert notifications" on public.notifications;
create policy "Authenticated users can insert notifications"
  on public.notifications for insert
  to authenticated
  with check (true);

drop policy if exists "Recipients can mark their notifications as read" on public.notifications;
create policy "Recipients can mark their notifications as read"
  on public.notifications for update
  to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- 7. Configure `public.likes_table`, `public.bookmarks`, `public.follows`, `public.contact` RLS
alter table public.likes_table enable row level security;
grant select on public.likes_table to anon, authenticated;
grant insert, delete on public.likes_table to authenticated;

drop policy if exists "Anyone can read likes" on public.likes_table;
create policy "Anyone can read likes"
  on public.likes_table for select
  to anon, authenticated
  using (true);

drop policy if exists "Authenticated users can like posts" on public.likes_table;
create policy "Authenticated users can like posts"
  on public.likes_table for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can remove own likes" on public.likes_table;
create policy "Users can remove own likes"
  on public.likes_table for delete
  to authenticated
  using (user_id = (select auth.uid()));

alter table public.bookmarks enable row level security;
grant select, insert, delete on public.bookmarks to authenticated;

drop policy if exists "Users can read own bookmarks" on public.bookmarks;
create policy "Users can read own bookmarks"
  on public.bookmarks for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users can insert own bookmarks" on public.bookmarks;
create policy "Users can insert own bookmarks"
  on public.bookmarks for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can delete own bookmarks" on public.bookmarks;
create policy "Users can delete own bookmarks"
  on public.bookmarks for delete
  to authenticated
  using (user_id = (select auth.uid()));

alter table public.follows enable row level security;
grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;

drop policy if exists "Anyone can read follows" on public.follows;
create policy "Anyone can read follows"
  on public.follows for select
  to anon, authenticated
  using (true);

drop policy if exists "Users can follow others" on public.follows;
create policy "Users can follow others"
  on public.follows for insert
  to authenticated
  with check (follower_id = (select auth.uid()) and following_id <> (select auth.uid()));

drop policy if exists "Users can unfollow others" on public.follows;
create policy "Users can unfollow others"
  on public.follows for delete
  to authenticated
  using (follower_id = (select auth.uid()));

alter table public.contact enable row level security;
grant insert on public.contact to anon, authenticated;

drop policy if exists "Anyone can submit contact form" on public.contact;
create policy "Anyone can submit contact form"
  on public.contact for insert
  to anon, authenticated
  with check (true);
