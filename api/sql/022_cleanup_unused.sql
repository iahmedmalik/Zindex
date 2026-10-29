-- Clean-up (29 Oct): drop what no longer has a job. The order's one status is the only status (the delivery and the
-- parcel have none of their own, and nothing reads their event trails), the rider's cash is now tracked by the payment
-- ledger (order_payments), and the store's logo lives in store_images. Nothing here is shown anywhere in the app today.
-- The delivery card function is rewritten first, without the pieces that go, so it never points at a dropped column.

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
    'expiresAt', c.expires_at
  )
  from delivery_cards c
  join orders o on o.id = c.order_id
  join stores s on s.id = o.store_id
  left join deliveries d on d.order_id = o.id
  where c.token_hash = p_token_hash and c.revoked_at is null and c.expires_at > now()
$$;

drop table delivery_events;
alter table deliveries drop column status, drop column cash_handed_over, drop column cash_handed_at;
drop table shipment_events;
alter table shipments drop column status, drop column failure_reason;
alter table stores drop column logo_url;
