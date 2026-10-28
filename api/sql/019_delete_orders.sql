-- Deleting an order (Ahmed, 29 Oct). The app never had the right to delete orders; the API now allows it for a pending
-- order, or a cancelled one whose stock is back, and only when no payment is recorded (see routes/orders.ts).
-- An order's invoice, items, delivery, card links and shipment go with it. Invoice numbers must never skip, so the
-- number of the store's LATEST invoice is given back when its order is deleted; an older invoice's order cannot be
-- deleted (Cancel keeps the number). Only this function moves the counter back, and only for the signed-in owner's store.

grant delete on orders to zx_app_role;

-- A cancelled order whose stock was put back has two ledger rows ("sale" and "restore") that cancel each other out. The
-- ledger forbids a sale or restore row without an order (stock_movements check), so the old "set null" would refuse the
-- delete. They go with the order instead: only orders with their stock back can be deleted, so no stock level changes.
alter table stock_movements drop constraint stock_movements_order_id_fkey;
alter table stock_movements add constraint stock_movements_order_id_fkey foreign key (order_id) references orders (id) on delete cascade;

create function release_invoice_number(p_store_id uuid, p_no integer) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update stores set next_invoice_no = next_invoice_no - 1
   where id = p_store_id
     and owner_id = current_setting('app.owner_id', true)
     and next_invoice_no > 1
     and next_invoice_no - 1 = p_no;
  return found;
end $$;
grant execute on function release_invoice_number(uuid, integer) to zx_app_role;
