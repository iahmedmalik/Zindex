-- Editing an order that already took stock out (Ahmed's brother, 30 Oct: "edit an order and its bill anytime").
-- When the items change, the difference goes into the ledger as one 'edit' movement tied to the order, so the stock level
-- is right at once and the ledger is still append-only. Cancelling later puts back the order's NET amount (sale + edits).
-- The two checks that listed the allowed reasons are replaced so that 'edit' is allowed (it has an order, either sign).

do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'stock_movements'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%''restore''%'
  loop
    execute format('alter table stock_movements drop constraint %I', c.conname);
  end loop;
end $$;

alter table stock_movements add constraint stock_movements_reason_check check (reason in ('sale', 'restore', 'adjustment', 'edit'));
alter table stock_movements add constraint stock_movements_sign_check
  check ((reason = 'sale' and delta < 0) or (reason = 'restore' and delta > 0) or reason in ('adjustment', 'edit'));
