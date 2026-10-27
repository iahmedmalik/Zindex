-- Invoices. One per order (unique order_id: no duplicate invoices). A draft has no number; finalising
-- takes the store's next gap-free number inside the same transaction, so a failed finalise hands
-- the number back. What an invoice shows comes from the order, so editing an order after its
-- invoice is final is allowed for the owner but is written to invoice_edits (append-only).

create table invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  store_id uuid not null references stores (id) on delete cascade,
  order_id uuid not null unique references orders (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'final')),
  number text,
  finalised_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'final') = (number is not null and finalised_at is not null))
);
create unique index invoices_store_number on invoices (store_id, number) where number is not null;
create index invoices_owner_id on invoices (owner_id);
create index invoices_store_created on invoices (store_id, created_at desc);

create table invoice_edits (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  invoice_id uuid not null references invoices (id) on delete cascade,
  changed_by text not null default current_setting('app.owner_id', true),
  changed text[] not null,
  before jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now()
);
create index invoice_edits_invoice on invoice_edits (invoice_id, created_at);

grant select on invoices to zx_app_role;
grant insert (store_id, order_id) on invoices to zx_app_role;
grant update (status, number, finalised_at) on invoices to zx_app_role;
alter table invoices enable row level security;
create policy invoices_owner on invoices
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from orders o where o.id = invoices.order_id and o.store_id = invoices.store_id)
  );

grant select on invoice_edits to zx_app_role;
grant insert (invoice_id, changed, before, after) on invoice_edits to zx_app_role;
alter table invoice_edits enable row level security;
create policy invoice_edits_owner on invoice_edits
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from invoices i where i.id = invoice_edits.invoice_id)
  );
