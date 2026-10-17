alter table public.notifications
  add column if not exists is_read boolean not null default false;

update public.notifications
set is_read = false
where is_read is null;

alter table public.notifications
  alter column is_read set default false,
  alter column is_read set not null;

alter table public.notifications enable row level security;

grant update (is_read) on public.notifications to authenticated;

drop policy if exists "Recipients can mark their notifications as read" on public.notifications;
create policy "Recipients can mark their notifications as read"
  on public.notifications for update
  to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
