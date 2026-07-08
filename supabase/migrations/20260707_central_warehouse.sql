-- Kho tổng + luồng đề xuất nhập hàng từ kho tổng về cửa hàng.
-- Chạy trong Supabase SQL Editor trước khi phát hành tính năng nếu DB chưa có các cột này.

begin;

alter table public.stores
  add column if not exists is_warehouse boolean not null default false;

update public.stores
set is_warehouse = true
where lower(coalesce(name, '')) in ('kho tổng', 'kho tong');

alter table public.inventory_tickets
  add column if not exists source_store_id bigint,
  add column if not exists destination_store_id bigint,
  add column if not exists items jsonb not null default '[]'::jsonb,
  add column if not exists note text,
  add column if not exists approved_by_source text,
  add column if not exists approved_by_dest text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists stores_is_warehouse_idx
  on public.stores (is_warehouse);

create index if not exists inventory_tickets_transfer_flow_idx
  on public.inventory_tickets (type, status, source_store_id, destination_store_id);

commit;
