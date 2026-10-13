alter table public.posts
  add column if not exists language text not null default 'English';
