-- Shopify product sync. A store can name its Shopify shop (sheen-perfumes.myshopify.com); the app's
-- keys stay in the server's environment, never in the database. Synced products remember their
-- Shopify id so a second sync updates them instead of adding copies. Stock is never synced.

alter table stores add column shopify_domain text check (shopify_domain is null or shopify_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$');
alter table stores add column shopify_synced_at timestamptz;
grant update (shopify_domain, shopify_synced_at) on stores to zx_app_role;

create unique index products_store_shopify on products (store_id, shopify_product_id) where shopify_product_id is not null;
grant update (shopify_product_id) on products to zx_app_role;
