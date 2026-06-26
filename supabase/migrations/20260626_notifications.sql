-- Nền tảng thông báo cho The Cốc mobile.
-- Chạy trong Supabase SQL Editor trước khi build bản Android/iOS production.

begin;

create extension if not exists pgcrypto;

alter table public.users
  add column if not exists push_token text;

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  expo_push_token text not null,
  platform text,
  device_name text,
  project_id text,
  app_version text,
  store_id bigint,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create index if not exists push_tokens_user_active_idx
  on public.push_tokens (user_id, is_active);

create index if not exists push_tokens_token_idx
  on public.push_tokens (expo_push_token);

create table if not exists public.notifications (
  id text primary key,
  user_id text not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}'::jsonb,
  type text not null default 'general',
  route text,
  store_id bigint,
  actor_user_id text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists type text not null default 'general',
  add column if not exists route text,
  add column if not exists store_id bigint,
  add column if not exists actor_user_id text,
  add column if not exists is_read boolean not null default false,
  add column if not exists created_at timestamptz not null default now();

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, is_read)
  where is_read = false;

commit;
