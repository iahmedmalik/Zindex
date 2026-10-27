-- Stock is an append-only ledger. Nothing is ever edited or deleted: a mistake is fixed with a new
-- movement. On hand = the sum of a product's deltas. The app role can only select and insert.
--
-- reason 'sale'    : written once when the owner confirms an order (negative)
-- reason 'restore' : written only when the owner approves putting a cancelled or returned order back (positive)
-- reason 'adjustment' : the owner counted, received or wrote off stock by hand (either sign)
-- The two partial unique indexes make a double deduction or a double restore impossible,
-- even if the same request arrives twice at the same moment.

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  delta integer not null check (delta <> 0 and delta between -1000000 and 1000000),
  reason text not null check (reason in ('sale', 'restore', 'adjustment')),
  order_id uuid references orders (id) on delete set null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  check ((reason = 'adjustment') = (order_id is null)),
  check ((reason = 'sale' and delta < 0) or (reason = 'restore' and delta > 0) or reason = 'adjustment')
);
create unique index stock_one_sale_per_order on stock_movements (order_id, product_id) where reason = 'sale';
create unique index stock_one_restore_per_order on stock_movements (order_id, product_id) where reason = 'restore';
create index stock_product on stock_movements (product_id, created_at desc);
create index stock_owner_id on stock_movements (owner_id);

grant select on stock_movements to zx_app_role;
grant insert (store_id, product_id, delta, reason, order_id, note) on stock_movements to zx_app_role;
alter table stock_movements enable row level security;
create policy stock_owner on stock_movements
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from products p where p.id = stock_movements.product_id and p.store_id = stock_movements.store_id)
  );
