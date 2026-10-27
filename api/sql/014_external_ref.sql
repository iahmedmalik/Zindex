-- Orders that came from elsewhere (a Shopify export) keep the outside reference, such as "#1042".
-- One reference per store, so importing the same file twice never makes the order twice.
alter table orders add column external_ref text check (external_ref is null or char_length(external_ref) between 1 and 40);
create unique index orders_external_ref on orders (store_id, external_ref) where external_ref is not null;
grant insert (external_ref) on orders to zx_app_role;
