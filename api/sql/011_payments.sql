-- Payment is never marked received on its own. The owner confirms it:
--  * paid in advance (Easypaisa, JazzCash, bank transfer): "I can see the money" -> payment_confirmed_at
--  * COD: the rider hands the cash to the store -> deliveries.cash_handed_over (set together with payment_confirmed_at)
-- A mistake can be undone (the timestamp cleared) so records can be corrected.

alter table orders add column payment_confirmed_at timestamptz;
grant update (payment_confirmed_at) on orders to zx_app_role;
