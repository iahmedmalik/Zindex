-- Courier shipments (out-of-city parcels), recorded by hand: no courier integration. One shipment per
-- order (unique order_id: no duplicates). The owner pastes the courier's tracking link if there is one.
-- shipment_events keeps the status history.

create table shipments (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  order_id uuid not null unique references orders (id) on delete cascade,
  courier text not null check (char_length(courier) between 1 and 40),
  tracking_no text check (tracking_no is null or char_length(tracking_no) between 1 and 60),
  tracking_url text check (tracking_url is null or tracking_url ~ '^https://'),
  shipped_on date,
  status text not null default 'shipped' check (status in ('shipped', 'delivered', 'delayed', 'returned', 'failed')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index shipments_tracking on shipments (store_id, lower(courier), tracking_no) where tracking_no is not null;
create index shipments_owner_id on shipments (owner_id);
create index shipments_store_status on shipments (store_id, status);

create table shipment_events (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  shipment_id uuid not null references shipments (id) on delete cascade,
  status text not null,
  note text,
  created_at timestamptz not null default now()
);
create index shipment_events_shipment on shipment_events (shipment_id, created_at);

grant select on shipments to zx_app_role;
grant insert (store_id, order_id, courier, tracking_no, tracking_url, shipped_on) on shipments to zx_app_role;
grant update (courier, tracking_no, tracking_url, shipped_on, status, failure_reason, updated_at) on shipments to zx_app_role;
alter table shipments enable row level security;
create policy shipments_owner on shipments
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from orders o where o.id = shipments.order_id and o.store_id = shipments.store_id)
  );

grant select on shipment_events to zx_app_role;
grant insert (shipment_id, status, note) on shipment_events to zx_app_role;
alter table shipment_events enable row level security;
create policy shipment_events_owner on shipment_events
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from shipments s where s.id = shipment_events.shipment_id)
  );
