-- Store email (shown on that store's receipts), the time a rider's photo was taken, and the tracking
-- link the owner pastes from inDrive or Yango so the customer can follow the trip. All optional.

alter table stores add column email text check (email is null or (length(email) <= 120 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
grant insert (email) on stores to zx_app_role;
grant update (email) on stores to zx_app_role;

alter table deliveries add column rider_photo_taken_at timestamptz;
alter table deliveries add column tracking_url text check (tracking_url is null or tracking_url ~ '^https://');
grant update (rider_photo_taken_at, tracking_url) on deliveries to zx_app_role;

-- The public card now also returns the store's email and address and the delivery's tracking link and
-- photo time. Still no customer phone and no other orders.
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
      'bikeNumber', d.bike_number, 'riderPhotoUrl', d.rider_photo_url, 'riderPhotoTakenAt', d.rider_photo_taken_at,
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
