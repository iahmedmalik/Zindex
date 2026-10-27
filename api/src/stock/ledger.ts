import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { rows } from "../db/query";

// The stock rules, in one place:
//  * Stock moves when the owner CONFIRMS an order, never when it is only entered or imported.
//  * An order that is confirmed twice, or whose request is sent twice, moves stock once (the
//    unique index in the database is the real guard; "on conflict do nothing" makes a repeat harmless).
//  * Cancelling or returning does NOT put stock back by itself: the owner approves it.
//  * Zero or negative stock never blocks a sale; the caller gets a warning to show.

export type StockWarning = { productId: string; name: string; onHand: number };

export async function deductForOrder(tx: Tx, storeId: string, orderId: string): Promise<StockWarning[]> {
  await tx.execute(
    sql`insert into stock_movements (store_id, product_id, delta, reason, order_id)
        select ${storeId}, i.product_id, -sum(i.quantity)::int, 'sale', ${orderId}
          from order_items i where i.order_id = ${orderId} and i.product_id is not null
         group by i.product_id
        on conflict (order_id, product_id) where reason = 'sale' do nothing`,
  );
  await tx.execute(sql`update orders set stock_applied = true where id = ${orderId}`);
  return rows<StockWarning>(
    tx,
    sql`select p.id as product_id, p.name, coalesce(sum(m.delta), 0)::int as on_hand
          from products p join stock_movements m on m.product_id = p.id
         where p.id in (select product_id from order_items where order_id = ${orderId} and product_id is not null)
         group by p.id, p.name having coalesce(sum(m.delta), 0) < 0`,
  );
}

/** Puts a cancelled or returned order's stock back. Only called after the owner approves. */
export async function restoreForOrder(tx: Tx, storeId: string, orderId: string): Promise<number> {
  const put = await rows<{ id: string }>(
    tx,
    sql`insert into stock_movements (store_id, product_id, delta, reason, order_id)
        select ${storeId}, product_id, -delta, 'restore', ${orderId}
          from stock_movements where order_id = ${orderId} and reason = 'sale'
        on conflict (order_id, product_id) where reason = 'restore' do nothing
        returning id`,
  );
  await tx.execute(sql`update orders set stock_applied = false where id = ${orderId}`);
  return put.length;
}
