-- Local delivery by inDrive or Yango. One delivery per order. The owner books the ride in the other
-- app by hand and types the rider's details here; the status trail (delivery_events) is the saved
-- delivery history. cash_handed_over records whether the rider gave the store the COD cash.
-- Rider photo and screenshot are links for now (where images are stored is still an open decision).

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  order_id uuid not null unique references orders (id) on delete cascade,
  service text check (service is null or service in ('indrive', 'yango')),
  rider_name text check (rider_name is null or char_length(rider_name) between 1 and 80),
  rider_phone text check (rider_phone is null or rider_phone ~ '^[0-9]{7,15}$'),
  bike_number text check (bike_number is null or char_length(bike_number) between 1 and 20),
  rider_photo_url text check (rider_photo_url is null or rider_photo_url ~ '^https://'),
  rider_screenshot_url text check (rider_screenshot_url is null or rider_screenshot_url ~ '^https://'),
  pickup_address text check (pickup_address is null or char_length(pickup_address) <= 300),
  notes text check (notes is null or char_length(notes) <= 300),
  status text not null default 'pending' check (status in ('pending', 'booked', 'picked_up', 'delivered')),
  cash_handed_over boolean not null default false,
  cash_handed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index deliveries_owner_id on deliveries (owner_id);
create index deliveries_store_status on deliveries (store_id, status);

create table delivery_events (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  delivery_id uuid not null references deliveries (id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now()
);
create index delivery_events_delivery on delivery_events (delivery_id, created_at);

grant select on deliveries to zx_app_role;
grant insert (store_id, order_id) on deliveries to zx_app_role;
grant update (service, rider_name, rider_phone, bike_number, rider_photo_url, rider_screenshot_url, pickup_address, notes,
              status, cash_handed_over, cash_handed_at, updated_at) on deliveries to zx_app_role;
alter table deliveries enable row level security;
create policy deliveries_owner on deliveries
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from orders o where o.id = deliveries.order_id and o.store_id = deliveries.store_id)
  );

grant select on delivery_events to zx_app_role;
grant insert (delivery_id, status) on delivery_events to zx_app_role;
alter table delivery_events enable row level security;
create policy delivery_events_owner on delivery_events
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from deliveries d where d.id = delivery_events.delivery_id)
  );
