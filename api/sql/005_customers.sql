-- Customers: one list per store. The same person buying from two stores is two customer rows on
-- purpose, so the stores' records are never merged. The phone number (digits only, normalised by
-- the API) is what stops accidental duplicates inside one store.

create table customers (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  phone text not null check (phone ~ '^[0-9]{7,15}$'),
  addresses text[] not null default '{}' check (cardinality(addresses) <= 10),
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, phone)
);
create index customers_owner_id on customers (owner_id);
create index customers_store_name on customers (store_id, lower(name));

grant select, delete on customers to zx_app_role;
grant insert (store_id, name, phone, addresses, notes) on customers to zx_app_role;
grant update (name, phone, addresses, notes, updated_at) on customers to zx_app_role;
alter table customers enable row level security;
create policy customers_owner on customers
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from stores s where s.id = customers.store_id)
  );
