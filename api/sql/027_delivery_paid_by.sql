-- Who pays for delivery (31 Oct, from the owner's brother): on a rider or courier order the customer pays (as always)
-- or the store does. "store" means the customer's total is goods only and the delivery fee or charge typed on the order is
-- the store's own cost (reports take it off profit). Every existing order stays "customer", so nothing changes for them.

alter table orders add column delivery_paid_by text not null default 'customer' check (delivery_paid_by in ('customer', 'store'));
grant insert (delivery_paid_by) on orders to zx_app_role;
grant update (delivery_paid_by) on orders to zx_app_role;

-- The customer's card never mentions delivery money the store pays: it shows 0 for both, so no line appears.
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
