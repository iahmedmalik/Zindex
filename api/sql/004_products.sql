-- Products: one catalogue per store, so the same product can have a different price in each store.
-- Every table from here on carries owner_id, filled in automatically from app.owner_id, and a
-- policy that only lets an owner touch rows whose store is theirs.

create table products (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  price integer not null check (price >= 0),
  cost integer check (cost is null or cost >= 0),
  active boolean not null default true,
  shopify_product_id text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_store_name on products (store_id, lower(name));
create index products_owner_id on products (owner_id);

grant select, delete on products to zx_app_role;
grant insert (store_id, name, price, cost, active, shopify_product_id, image_url) on products to zx_app_role;
grant update (name, price, cost, active, image_url, updated_at) on products to zx_app_role;
alter table products enable row level security;
create policy products_owner on products
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from stores s where s.id = products.store_id)
  );
