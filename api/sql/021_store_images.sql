-- A logo and a watermark for each store (Ahmed, 29 Oct). Each is one small picture kept in Neon, like the rider photo: the
-- browser shrinks it first and the table refuses anything over 300 KB. The logo goes on the invoice, the receipt and the
-- customer's card; the watermark sits faint behind the invoice and can be switched off without losing the picture.
-- stores.logo_version / watermark_version are the time it was saved (in ms): they let the page ask for a fresh copy.
-- The customer reaches the pictures only through get_card_store_image(), which checks the card link first.

alter table stores add column logo_version bigint, add column watermark_version bigint, add column watermark_on boolean not null default true;
grant update (logo_version, watermark_version, watermark_on) on stores to zx_app_role;

create table store_images (
  store_id uuid not null references stores (id) on delete cascade,
  kind text not null check (kind in ('logo', 'watermark')),
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  image bytea not null check (octet_length(image) between 1 and 300000),
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  created_at timestamptz not null default now(),
  primary key (store_id, kind)
);
create index store_images_owner_id on store_images (owner_id);

grant select, delete on store_images to zx_app_role;
grant insert (store_id, kind, image, content_type) on store_images to zx_app_role;
grant update (image, content_type, created_at) on store_images to zx_app_role;
alter table store_images enable row level security;
create policy store_images_owner on store_images
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from stores s where s.id = store_images.store_id)
  );

create function get_card_store_image(p_token_hash text, p_kind text) returns table (image bytea, content_type text)
language sql stable security definer set search_path = public as $$
  select i.image, i.content_type
  from delivery_cards c
  join orders o on o.id = c.order_id
  join stores s on s.id = o.store_id
  join store_images i on i.store_id = s.id and i.kind = p_kind
  where c.token_hash = p_token_hash and c.revoked_at is null and c.expires_at > now()
    and (p_kind = 'logo' or s.watermark_on)
$$;
grant execute on function get_card_store_image(text, text) to zx_app_role;

-- The card says whether the store has a logo and a watermark; the pictures come from their own addresses.
create or replace function get_delivery_card(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'store', jsonb_build_object('name', s.name, 'phone', s.phone, 'email', s.email, 'address', s.address, 'logoUrl', s.logo_url, 'accent', s.accent,
      'hasLogo', s.logo_version is not null, 'hasWatermark', s.watermark_version is not null and s.watermark_on),
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
