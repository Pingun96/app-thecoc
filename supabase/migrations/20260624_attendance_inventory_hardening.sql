-- Nâng cấp an toàn cho app thecoc-mobile.
-- Chạy file này trong Supabase SQL Editor trước khi phát hành production.

begin;

-- Chấm công: giữ các cột cũ để app hiện tại vẫn đọc được, bổ sung dữ liệu chuẩn.
alter table public.attendance_logs
  add column if not exists store_id bigint,
  add column if not exists check_in_at timestamptz,
  add column if not exists check_out_at timestamptz,
  add column if not exists check_in_lat double precision,
  add column if not exists check_in_lng double precision,
  add column if not exists check_out_lat double precision,
  add column if not exists check_out_lng double precision,
  add column if not exists check_in_photo_path text,
  add column if not exists check_out_photo_path text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists attendance_logs_user_date_idx
  on public.attendance_logs (user_id, date);

create index if not exists attendance_logs_open_shift_idx
  on public.attendance_logs (user_id, date)
  where check_out is null;

-- Kho: tăng tốc tính tồn và lọc phiếu duyệt.
create index if not exists inventory_logs_item_store_idx
  on public.inventory_logs (itemid, store_id);

create index if not exists inventory_requests_status_store_idx
  on public.inventory_requests (status, store_id);

-- Duyệt phiếu và ghi sổ kho trong cùng một transaction.
create or replace function public.approve_inventory_request(p_request_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_request public.inventory_requests%rowtype;
  v_current_stock numeric := 0;
  v_log_id text := 'log_' || p_request_id;
begin
  select *
  into v_request
  from public.inventory_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu yêu cầu.';
  end if;

  if v_request.status not in ('PENDING_MANAGER', 'PENDING_OWNER') then
    raise exception 'Phiếu đã được xử lý.';
  end if;

  select coalesce(sum(
    case
      when type in ('IMPORT', 'ADJUST_UP') then amount
      when type in ('EXPORT', 'ADJUST_DOWN') then -amount
      else 0
    end
  ), 0)
  into v_current_stock
  from public.inventory_logs
  where itemid = v_request.itemid
    and store_id = v_request.store_id;

  if v_request.type in ('EXPORT', 'ADJUST_DOWN')
     and v_request.amount > v_current_stock then
    raise exception 'Không đủ tồn kho. Tồn hiện tại: %', v_current_stock;
  end if;

  insert into public.inventory_logs (
    id,
    itemid,
    type,
    amount,
    date,
    store_id
  )
  values (
    v_log_id,
    v_request.itemid,
    v_request.type,
    v_request.amount,
    current_date,
    v_request.store_id
  )
  on conflict (id) do nothing;

  update public.inventory_requests
  set status = 'APPROVED'
  where id = p_request_id;

  return jsonb_build_object(
    'request_id', p_request_id,
    'log_id', v_log_id,
    'status', 'APPROVED'
  );
end;
$$;

-- Bucket riêng tư cho ảnh chấm công. Cần Supabase Auth hoặc Edge Function
-- để cấp quyền upload an toàn; không mở quyền ghi công khai cho anon.
insert into storage.buckets (id, name, public)
values ('attendance-photos', 'attendance-photos', false)
on conflict (id) do update set public = excluded.public;

commit;
