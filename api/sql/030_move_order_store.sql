-- Moving an order to another of the owner's stores (edit page, "Store" field).
-- The order takes a new number in the new store, and the rows that carry the store with it move too.
-- Row-level security is unchanged: every policy already requires the order, invoice, delivery and parcel to
-- be in the same store, and the new store must belong to the same owner.
grant update (store_id, order_no) on orders to zx_app_role;
grant update (store_id) on invoices to zx_app_role;
grant update (store_id) on deliveries to zx_app_role;
grant update (store_id) on shipments to zx_app_role;
