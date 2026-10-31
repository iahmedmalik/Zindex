-- The courier card (31 Oct): a courier order's delivery card now shows the courier, the tracking number, the tracking
-- link and an optional photo of the parcel, like the rider card does for a local delivery. The photo works exactly like
-- the rider's (017): one small JPEG or WebP per parcel, kept in Neon, gone with the parcel, shown to the customer only
-- through get_shipment_photo(), which checks the card link first. A photo needs a saved courier (the parcel record).

create table shipment_photos (
  shipment_id uuid primary key references shipments (id) on delete cascade,
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  image bytea not null check (octet_length(image) between 1 and 600000),
  content_type text not null check (content_type in ('image/jpeg', 'image/webp')),
  created_at timestamptz not null default now()
);
create index shipment_photos_owner_id on shipment_photos (owner_id);

grant select, delete on shipment_photos to zx_app_role;
grant insert (shipment_id, image, content_type) on shipment_photos to zx_app_role;
grant update (image, content_type, created_at) on shipment_photos to zx_app_role;
alter table shipment_photos enable row level security;
create policy shipment_photos_owner on shipment_photos
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from shipments s where s.id = shipment_photos.shipment_id)
  );

create function get_shipment_photo(p_token_hash text) returns table (image bytea, content_type text)
language sql stable security definer set search_path = public as $$
  select p.image, p.content_type
  from delivery_cards c
  join shipments s on s.order_id = c.order_id
  join shipment_photos p on p.shipment_id = s.id
  where c.token_hash = p_token_hash and c.revoked_at is null and c.expires_at > now()
$$;
grant execute on function get_shipment_photo(text) to zx_app_role;

-- The card gains a 'shipment' part (null when the order has no courier saved). Everything else is as in 022.
create or replace function get_delivery_card(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'store', jsonb_build_object('name', s.name, 'phone', s.phone, 'email', s.email, 'address', s.address, 'accent', s.accent,
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
      'service', d.service, 'riderName', d.rider_name, 'riderPhone', d.rider_phone,
      'bikeNumber', d.bike_number, 'riderPhotoUrl', d.rider_photo_url,
      'hasPhoto', exists (select 1 from delivery_photos p where p.delivery_id = d.id),
      'riderPhotoTakenAt', coalesce((select p.created_at from delivery_photos p where p.delivery_id = d.id), d.rider_photo_taken_at),
      'riderScreenshotUrl', d.rider_screenshot_url, 'trackingUrl', d.tracking_url
    ) end,
    'shipment', case when sh.id is null then null else jsonb_build_object(
      'courier', sh.courier, 'trackingNo', sh.tracking_no, 'trackingUrl', sh.tracking_url,
      'hasPhoto', exists (select 1 from shipment_photos p where p.shipment_id = sh.id),
      'photoTakenAt', (select p.created_at from shipment_photos p where p.shipment_id = sh.id)
    ) end,
    'expiresAt', c.expires_at
  )
  from delivery_cards c
  join orders o on o.id = c.order_id
  join stores s on s.id = o.store_id
  left join deliveries d on d.order_id = o.id
  left join shipments sh on sh.order_id = o.id
  where c.token_hash = p_token_hash and c.revoked_at is null and c.expires_at > now()
$$;

-- The same 7-day clean-up as the rider photos: kept while a card link for the order is live or ran out less than
-- 7 days ago, gone otherwise once 7 days old. The function now clears both kinds and returns the total removed.
create or replace function purge_delivery_photos() returns integer
language plpgsql security definer set search_path = public as $$
declare removed integer; removed_parcels integer;
begin
  delete from delivery_photos p
   where p.created_at < now() - interval '7 days'
     and not exists (
       select 1 from delivery_cards c join deliveries d on d.order_id = c.order_id
        where d.id = p.delivery_id and c.revoked_at is null and c.expires_at > now() - interval '7 days'
     );
  get diagnostics removed = row_count;
  delete from shipment_photos p
   where p.created_at < now() - interval '7 days'
     and not exists (
       select 1 from delivery_cards c join shipments s on s.order_id = c.order_id
        where s.id = p.shipment_id and c.revoked_at is null and c.expires_at > now() - interval '7 days'
     );
  get diagnostics removed_parcels = row_count;
  return removed + removed_parcels;
end $$;
