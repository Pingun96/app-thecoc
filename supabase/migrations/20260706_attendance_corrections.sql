-- Lịch sử chỉnh công và duyệt chỉnh công.
-- Chạy trong Supabase SQL Editor để bật đầy đủ log/duyệt khi nhân viên bấm nhầm check-out.

begin;

create table if not exists public.attendance_corrections (
  id text primary key,
  attendance_id text not null,
  user_id text not null,
  store_id bigint,
  date text not null,
  action text not null default 'REOPEN_AFTER_MISTAKEN_CHECKOUT',
  previous_check_out text,
  previous_check_out_at timestamptz,
  previous_hours numeric not null default 0,
  requested_by text,
  note text not null default '',
  status text not null default 'PENDING',
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text not null default '',
  created_at timestamptz not null default now()
);

alter table public.attendance_corrections
  add column if not exists store_id bigint,
  add column if not exists action text not null default 'REOPEN_AFTER_MISTAKEN_CHECKOUT',
  add column if not exists previous_check_out text,
  add column if not exists previous_check_out_at timestamptz,
  add column if not exists previous_hours numeric not null default 0,
  add column if not exists requested_by text,
  add column if not exists note text not null default '',
  add column if not exists status text not null default 'PENDING',
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text not null default '',
  add column if not exists created_at timestamptz not null default now();

create index if not exists attendance_corrections_status_idx
  on public.attendance_corrections (status, created_at desc);

create index if not exists attendance_corrections_user_date_idx
  on public.attendance_corrections (user_id, date);

commit;
