-- Stores: each owner can run several (for example Sheen Food, Sheen Perfumes). Every other
-- table later hangs off a store, so "whose data is this?" always has one answer: the owner.
--
-- Invoice numbers are per store and gap-free. The counter lives on the store row and is only
-- ever moved by allocate_invoice_number(), which must run in the same transaction as the
-- invoice insert: if the invoice fails, the number is handed back with the rollback.

create table stores (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references "user" (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  phone text check (phone is null or char_length(phone) <= 30),
  address text check (address is null or char_length(address) <= 300),
  logo_url text,
  accent text not null default '#5d1b23' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{1,8}$'),
  next_invoice_no integer not null default 1 check (next_invoice_no >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);
create index stores_owner_id on stores (owner_id);

-- Hands out the next invoice number ("SF-0007") for one store, only if it belongs to the
-- signed-in owner (app.owner_id). It runs as its definer because the app role may not update
-- the counter column directly; the owner check inside is what keeps it safe.
create function allocate_invoice_number(p_store_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_prefix text;
  v_no integer;
begin
  update stores set next_invoice_no = next_invoice_no + 1
   where id = p_store_id
     and owner_id = current_setting('app.owner_id', true)
  returning invoice_prefix, next_invoice_no - 1 into v_prefix, v_no;
  if not found then
    raise exception 'store not found' using errcode = 'P0002';
  end if;
  return v_prefix || '-' || lpad(v_no::text, 4, '0');
end $$;
