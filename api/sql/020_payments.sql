-- The payment ledger (Ahmed, 29 Oct): every payment on an order, one row each, so a customer who pays later can pay in
-- chunks over days, and COD cash can come back from a rider or a courier in chunks. The order's "expected" amount is the
-- cash-on-delivery amount for a COD order and the total for any other; what is left is expected minus the payments.
-- orders.payment_confirmed_at stays as "fully paid at" (the API sets it when the payments reach what is expected).
-- A payment is removed (undone) only by deleting its row; amounts are never edited.

create table order_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  amount integer not null check (amount > 0 and amount <= 100000000),
  method text check (method is null or char_length(method) between 1 and 40),
  note text check (note is null or char_length(note) <= 200),
  received_on date not null default ((now() at time zone 'Asia/Karachi')::date),
  created_at timestamptz not null default now()
);
create index order_payments_order on order_payments (order_id, created_at);
create index order_payments_owner_id on order_payments (owner_id);
create index order_payments_received on order_payments (received_on);

grant select, delete on order_payments to zx_app_role;
grant insert (order_id, amount, method, note, received_on) on order_payments to zx_app_role;
alter table order_payments enable row level security;
create policy order_payments_owner on order_payments
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from orders o where o.id = order_payments.order_id)
  );

-- Payments already recorded become one full payment each, at the time they were recorded.
insert into order_payments (owner_id, order_id, amount, method, received_on, created_at)
select o.owner_id, o.id, case when o.payment = 'cod' then o.cod_amount else o.total end, o.payment_method,
       (o.payment_confirmed_at at time zone 'Asia/Karachi')::date, o.payment_confirmed_at
  from orders o
 where o.payment_confirmed_at is not null and (case when o.payment = 'cod' then o.cod_amount else o.total end) > 0;

-- When an order was delivered, to say "delivered 4 days ago" next to money still to collect.
alter table orders add column delivered_at timestamptz;
update orders set delivered_at = updated_at where status = 'delivered';
grant update (delivered_at) on orders to zx_app_role;

-- The customer's card also says how much of the order has been paid (a pay-later customer pays the shop in chunks).
create or replace function get_delivery_card(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'store', jsonb_build_object('name', s.name, 'phone', s.phone, 'email', s.email, 'address', s.address, 'logoUrl', s.logo_url, 'accent', s.accent),
    'order', jsonb_build_object(
      'orderNo', o.order_no, 'status', o.status, 'customerName', o.customer_name,
      'address', o.address, 'payment', o.payment,
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity) order by i.position)
                           from order_items i where i.order_id = o.id), '[]'::jsonb),
      'subtotal', o.subtotal, 'discount', o.discount, 'deliveryCharge', o.delivery_charge, 'total', o.total,
      'riderFee', o.rider_fee, 'codAmount', o.cod_amount, 'collectAtDoor', o.collect_at_door,
      'paid', coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id), 0)::int
    ),
    'delivery', case when d.id is null then null else jsonb_build_object(
      'status', d.status, 'service', d.service, 'riderName', d.rider_name, 'riderPhone', d.rider_phone,
      'bikeNumber', d.bike_number, 'riderPhotoUrl', d.rider_photo_url,
      'hasPhoto', exists (select 1 from delivery_photos p where p.delivery_id = d.id),
      'riderPhotoTakenAt', coalesce((select p.created_at from delivery_photos p where p.delivery_id = d.id), d.rider_photo_taken_at),
      'riderScreenshotUrl', d.rider_screenshot_url, 'trackingUrl', d.tracking_url,
      'events', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.created_at) order by e.created_at)
                            from delivery_events e where e.delivery_id = d.id), '[]'::jsonb)
    ) end,
    'expiresAt', c.expires_at
  )
  from delivery_cards c
  join orders o on o.id = c.order_id
  join stores s on s.id = o.store_id
  left join deliveries d on d.order_id = o.id
  where c.token_hash = p_token_hash and c.revoked_at is null and c.expires_at > now()
$$;
