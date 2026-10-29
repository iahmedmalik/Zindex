-- A customer can be saved with a name only (Ahmed's brother, 30 Oct: "find an old customer by name too").
-- Without a phone the store's own list is told apart by name, so the same name is never saved twice there; with a phone
-- nothing changes (unique per store). Two people with the same name AND different phones stay two customers.

alter table customers alter column phone drop not null;
create unique index customers_store_name_no_phone on customers (store_id, lower(name)) where phone is null;
