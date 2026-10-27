-- The rider's photo, taken fresh by the owner (camera or gallery). Kept in Neon (Ahmed, 28 Oct), one
-- small picture per delivery: the browser shrinks it first and the table refuses anything over 600 KB.
-- It goes when the delivery goes. The customer gets it only through get_delivery_photo(), which checks
-- the card link first, so an expired or revoked link shows nothing.

create table delivery_photos (
  delivery_id uuid primary key references deliveries (id) on delete cascade,
  owner_id text not null default current_setting('app.owner_id', true) references "user" (id) on delete cascade,
  image bytea not null check (octet_length(image) between 1 and 600000),
  content_type text not null check (content_type in ('image/jpeg', 'image/webp')),
  created_at timestamptz not null default now()
);
create index delivery_photos_owner_id on delivery_photos (owner_id);

grant select, delete on delivery_photos to zx_app_role;
grant insert (delivery_id, image, content_type) on delivery_photos to zx_app_role;
grant update (image, content_type, created_at) on delivery_photos to zx_app_role;
alter table delivery_photos enable row level security;
create policy delivery_photos_owner on delivery_photos
  for all to zx_app_role
  using (owner_id = current_setting('app.owner_id', true))
  with check (
    owner_id = current_setting('app.owner_id', true)
    and exists (select 1 from deliveries d where d.id = delivery_photos.delivery_id)
  );

create function get_delivery_photo(p_token_hash text) returns table (image bytea, content_type text)
language sql stable security definer set search_path = public as $$
  select p.image, p.content_type
  from delivery_cards c
  join deliveries d on d.order_id = c.order_id
  join delivery_photos p on p.delivery_id = d.id
  where c.token_hash = p_token_hash and c.revoked_at is null and c.expires_at > now()
$$;
grant execute on function get_delivery_photo(text) to zx_app_role;

-- The card says whether there is a photo and when it was taken; the picture itself comes from its own
-- address so the card stays small.
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
      'riderFee', o.rider_fee, 'codAmount', o.cod_amount, 'collectAtDoor', o.collect_at_door
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

-- Cleanup. A photo shows a rider's face and the database is small, so it does not stay for ever: it is
-- kept while a card link for it is live or ran out less than 7 days ago, and goes otherwise once it is
-- 7 days old. The API runs this on start and every 6 hours. Returns how many photos it removed.
create function purge_delivery_photos() returns integer
language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  delete from delivery_photos p
   where p.created_at < now() - interval '7 days'
     and not exists (
       select 1 from delivery_cards c join deliveries d on d.order_id = c.order_id
        where d.id = p.delivery_id and c.revoked_at is null and c.expires_at > now() - interval '7 days'
     );
  get diagnostics removed = row_count;
  return removed;
end $$;
grant execute on function purge_delivery_photos() to zx_app_role;
