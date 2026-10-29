-- A discount on one item (Ahmed's brother, 30 Oct). The owner types it as a percent of the line or as rupees off the WHOLE
-- line (quantity x price); the API works out discount_amount (whole rupees) with the same rules as totals.ts and keeps what
-- was typed (kind, value) so the discount card can be opened again. order_items.unit_price stays the price before the
-- discount, so an invoice can show both. orders.subtotal is now the sum of the lines AFTER their discounts; orders.discount
-- stays the order-level discount only.

alter table order_items
  add column discount_kind text check (discount_kind in ('percent', 'amount')),
  add column discount_value integer check (discount_value >= 0),
  add column discount_amount integer not null default 0 check (discount_amount >= 0),
  add check ((discount_kind is null) = (discount_value is null)),
  add check (discount_amount <= quantity * unit_price);

grant insert (discount_kind, discount_value, discount_amount) on order_items to zx_app_role;
