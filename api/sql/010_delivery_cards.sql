-- The public delivery card. The customer opens a link from WhatsApp, with no account. The link holds
-- a random token; only its SHA-256 hash is stored, so a database leak does not leak working links.
-- Links expire and the owner can revoke them. A customer's page is served by get_delivery_card(), a
-- security definer function that returns ONLY what the card shows (no customer phone, no other
-- orders), because the person opening it is not a signed-in owner and row-level security would
-- (rightly) show them nothing.

create table delivery_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  order_id uuid not null references orders (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index delivery_cards_order on delivery_cards (order_id);
create index delivery_cards_owner_id on delivery_cards (owner_id);

grant select on delivery_cards to zx_app_role;
grant insert (order_id, token_hash, expires_at) on delivery_cards to zx_app_role;
grant update (revoked_at) on delivery_cards to zx_app_role;
alter table delivery_cards enable row level security;
create policy delivery_cards_owner on delivery_cards
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from orders o where o.id = delivery_cards.order_id)
  );

create function get_delivery_card(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'store', jsonb_build_object('name', s.name, 'phone', s.phone, 'logoUrl', s.logo_url, 'accent', s.accent),
    'order', jsonb_build_object(
      'orderNo', o.order_no, 'status', o.status, 'customerName', o.customer_name,
      'address', o.address, 'payment', o.payment,
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity) order by i.position)
                           from order_items i where i.order_id = o.id), '[]'::jsonb),
      'subtotal', o.subtotal, 'discount', o.discount, 'deliveryCharge', o.delivery_charge, 'total', o.total,
      'riderFee', o.rider_fee, 'codAmount', o.cod_amount, 'collectAtDoor', o.collect_at_door
    ),
    'delivery', case when d.id is null then null else jsonb_build_object(
      'status', d.status, 'service', d.service, 'riderName', d.rider_name, 'riderPhone', d.rider_phone,
      'bikeNumber', d.bike_number, 'riderPhotoUrl', d.rider_photo_url, 'riderScreenshotUrl', d.rider_screenshot_url,
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
grant execute on function get_delivery_card(text) to zx_app_role;
