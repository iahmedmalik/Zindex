-- Pickup orders use pickup wording (31 Oct, #62). The stored statuses do not change (out_for_delivery is shown as
-- "Ready for pickup" and delivered as "Picked up" on a pickup order). What is new in the data:
--  - orders.pickup_map_url: an optional https link (a Google Maps pin) the owner pastes on a pickup order; the customer's
--    card shows it as a "Get directions" button
--  - a message template for pickup: ready_for_pickup
--  - the delivery card now says the order's kind and carries the map link, so it can show pickup wording

alter table orders add column pickup_map_url text check (pickup_map_url is null or (pickup_map_url ~ '^https://' and char_length(pickup_map_url) <= 500));
grant insert (pickup_map_url) on orders to zx_app_role;
grant update (pickup_map_url) on orders to zx_app_role;

alter table message_templates drop constraint message_templates_key_check;
alter table message_templates add constraint message_templates_key_check
  check (key in ('order_confirmed', 'invoice', 'rider_assigned', 'on_the_way', 'delivered', 'payment_reminder', 'thank_you', 'ready_for_pickup'));

create or replace function get_delivery_card(p_token_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'store', jsonb_build_object('name', s.name, 'phone', s.phone, 'email', s.email, 'address', s.address, 'accent', s.accent,
      'hasLogo', s.logo_version is not null, 'hasWatermark', s.watermark_version is not null and s.watermark_on),
    'order', jsonb_build_object(
      'orderNo', o.order_no, 'status', o.status, 'customerName', o.customer_name, 'deliveryKind', o.delivery_kind, 'pickupMapUrl', o.pickup_map_url,
      'address', o.address, 'payment', o.payment,
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity) order by i.position)
                           from order_items i where i.order_id = o.id), '[]'::jsonb),
      'subtotal', o.subtotal, 'discount', o.discount,
      'deliveryCharge', case when o.delivery_paid_by = 'store' then 0 else o.delivery_charge end,
      'total', o.total,
      'riderFee', case when o.delivery_paid_by = 'store' then 0 else o.rider_fee end,
      'codAmount', o.cod_amount, 'collectAtDoor', o.collect_at_door,
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
