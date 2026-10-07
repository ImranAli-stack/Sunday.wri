create or replace function public.notify_post_like()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_author_id uuid;
  post_title text;
begin
  select user_id, title
  into post_author_id, post_title
  from public.posts
  where id = new.post_id
    and status = 'published';

  if post_author_id is null or post_author_id = new.user_id then
    return new;
  end if;

  insert into public.notifications (recipient_id, post_id, message, is_read)
  values (
    post_author_id,
    new.post_id,
    'Someone liked your post: "' || coalesce(post_title, 'Untitled story') || '"',
    false
  );

  return new;
end;
$$;

create or replace function public.notify_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_author_id uuid;
  post_title text;
begin
  select user_id, title
  into post_author_id, post_title
  from public.posts
  where id = new.post_id
    and status = 'published';

  if post_author_id is null or post_author_id = new.user_id then
    return new;
  end if;

  insert into public.notifications (recipient_id, post_id, message, is_read)
  values (
    post_author_id,
    new.post_id,
    'Someone commented on your post: "' || coalesce(post_title, 'Untitled story') || '"',
    false
  );

  return new;
end;
$$;

drop trigger if exists notify_post_author_on_like on public.likes_table;
create trigger notify_post_author_on_like
  after insert on public.likes_table
  for each row
  execute function public.notify_post_like();

drop trigger if exists notify_post_author_on_comment on public.comments;
create trigger notify_post_author_on_comment
  after insert on public.comments
  for each row
  execute function public.notify_post_comment();
