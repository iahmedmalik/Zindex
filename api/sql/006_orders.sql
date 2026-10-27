-- Orders and their items. The money columns are a snapshot written by the API from
-- calculateTotals() every time an order is saved; the phone never sends totals.
--
-- Order numbers are per store, handed out by allocate_order_no() like invoice numbers.
-- idempotency_key stops a retried save (bad signal on a phone) from making a second order.

alter table stores add column next_order_no integer not null default 1 check (next_order_no >= 1);

create function allocate_order_no(p_store_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_no integer;
begin
  update stores set next_order_no = next_order_no + 1
   where id = p_store_id
     and owner_id = current_setting('app.owner_id', true)
  returning next_order_no - 1 into v_no;
  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  return v_no;
end $$;
grant execute on function allocate_order_no(uuid) to zx_app_role;

create table orders (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  order_no integer not null,
  customer_id uuid references customers (id) on delete set null,
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  customer_phone text check (customer_phone is null or customer_phone ~ '^[0-9]{7,15}$'),
  address text check (address is null or char_length(address) <= 300),
  source text not null default 'whatsapp' check (source in ('whatsapp', 'shopify', 'manual')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'packed', 'out_for_delivery', 'delivered', 'returned', 'cancelled')),
  delivery_kind text not null default 'local' check (delivery_kind in ('local', 'courier', 'pickup')),
  payment text not null default 'cod' check (payment in ('paid', 'cod', 'unpaid')),
  payment_method text check (payment_method is null or char_length(payment_method) between 1 and 40),
  discount_percent integer not null default 0 check (discount_percent between 0 and 100),
  delivery_charge integer not null default 0 check (delivery_charge >= 0),
  rider_fee integer not null default 0 check (rider_fee >= 0),
  subtotal integer not null check (subtotal >= 0),
  discount integer not null check (discount >= 0),
  total integer not null check (total >= 0),
  cod_amount integer not null check (cod_amount >= 0),
  collect_at_door integer not null check (collect_at_door >= 0),
  amount_due integer not null check (amount_due >= 0),
  notes text check (notes is null or char_length(notes) <= 500),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 8 and 80),
  stock_applied boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, order_no)
);
create unique index orders_idempotency on orders (store_id, idempotency_key) where idempotency_key is not null;
create index orders_owner_id on orders (owner_id);
create index orders_store_status on orders (store_id, status, created_at desc);
create index orders_customer on orders (customer_id);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  product_id uuid references products (id) on delete set null,
  position integer not null,
  name text not null check (char_length(name) between 1 and 120),
  quantity integer not null check (quantity >= 1 and quantity <= 10000),
  unit_price integer not null check (unit_price >= 0)
);
create index order_items_order on order_items (order_id, position);
create index order_items_owner_id on order_items (owner_id);

grant select on orders to zx_app_role;
grant insert (store_id, order_no, customer_id, customer_name, customer_phone, address, source, delivery_kind, payment, payment_method,
              discount_percent, delivery_charge, rider_fee, subtotal, discount, total, cod_amount, collect_at_door, amount_due,
              notes, idempotency_key) on orders to zx_app_role;
grant update (customer_id, customer_name, customer_phone, address, delivery_kind, payment, payment_method, discount_percent,
              delivery_charge, rider_fee, subtotal, discount, total, cod_amount, collect_at_door, amount_due, notes, status,
              stock_applied, updated_at) on orders to zx_app_role;
alter table orders enable row level security;
create policy orders_owner on orders
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from stores s where s.id = orders.store_id)
  );

grant select, delete on order_items to zx_app_role;
grant insert (order_id, product_id, position, name, quantity, unit_price) on order_items to zx_app_role;
alter table order_items enable row level security;
create policy order_items_owner on order_items
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from orders o where o.id = order_items.order_id)
  );
