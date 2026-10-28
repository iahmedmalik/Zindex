-- The cost of each piece, saved on the order line when the order is made (Ahmed, 29 Oct: a product's cost changing
-- later must only affect new sales, never old ones). A line with no cost is simply unknown (null): it is left out of
-- profit and listed in "Costs to fill in", where the owner can add the cost later on purpose.
--
-- Orders made before this migration get the product's cost as it is today: the best that is known about them.

alter table order_items add column unit_cost integer check (unit_cost is null or unit_cost >= 0);

update order_items i set unit_cost = p.cost
  from products p
 where p.id = i.product_id and p.cost is not null;

grant insert (unit_cost) on order_items to zx_app_role;
grant update (unit_cost) on order_items to zx_app_role;
