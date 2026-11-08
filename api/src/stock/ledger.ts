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

/**
 * The items of an order that already took stock out were changed: the difference goes into the ledger as an 'edit'
 * movement (more units sold = negative). `before` and `after` are the order's lines; lines typed by hand have no product.
 */
export async function adjustForEdit(tx: Tx, storeId: string, orderId: string, orderNo: number, before: { productId: string | null; quantity: number }[], after: { productId: string | null; quantity: number }[]): Promise<void> {
  const sold = new Map<string, number>();
  for (const l of before) if (l.productId) sold.set(l.productId, (sold.get(l.productId) ?? 0) - l.quantity);
  for (const l of after) if (l.productId) sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.quantity);
  for (const [productId, soldMore] of sold) {
    if (soldMore === 0) continue;
    await tx.execute(
      sql`insert into stock_movements (store_id, product_id, delta, reason, order_id, note)
          values (${storeId}, ${productId}, ${-soldMore}, 'edit', ${orderId}, ${`Order #${orderNo} edited`})`,
    );
  }
}

/**
 * A confirmed order moves to another store: what it took out of the old store goes back (one 'edit' row per product that
 * is still out), and the new lines are taken out of the new store. Both use reason 'edit' so the order's single 'sale'
 * and 'restore' rows stay unique; a later cancel nets everything per product. Returns the products now below zero.
 */
export async function moveStock(tx: Tx, from: string, to: string, orderId: string, orderNo: number, after: { productId: string | null; quantity: number }[]): Promise<StockWarning[]> {
  await tx.execute(
    sql`insert into stock_movements (store_id, product_id, delta, reason, order_id, note)
        select ${from}, product_id, -sum(delta)::int, 'edit', ${orderId}, ${`Order #${orderNo} moved to another store`}
          from stock_movements where order_id = ${orderId} and store_id = ${from}
         group by product_id having sum(delta) <> 0`,
  );
  const wanted = new Map<string, number>();
  for (const l of after) if (l.productId) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);
  for (const [productId, qty] of wanted) {
    await tx.execute(
      sql`insert into stock_movements (store_id, product_id, delta, reason, order_id, note)
          values (${to}, ${productId}, ${-qty}, 'edit', ${orderId}, ${`Order #${orderNo} moved here`})`,
    );
  }
  if (wanted.size === 0) return [];
  return rows<StockWarning>(
    tx,
    sql`select p.id as product_id, p.name, coalesce(sum(m.delta), 0)::int as on_hand
          from products p join stock_movements m on m.product_id = p.id
         where p.id in (${sql.join([...wanted.keys()].map((id) => sql`${id}`), sql`, `)})
         group by p.id, p.name having coalesce(sum(m.delta), 0) < 0`,
  );
}

/** Puts a cancelled or returned order's stock back. Only called after the owner approves. */
export async function restoreForOrder(tx: Tx, storeId: string, orderId: string): Promise<number> {
  const put = await rows<{ id: string }>(
    tx,
    sql`insert into stock_movements (store_id, product_id, delta, reason, order_id)
        select ${storeId}, product_id, -sum(delta)::int, 'restore', ${orderId}
          from stock_movements where order_id = ${orderId} and reason in ('sale', 'edit')
         group by product_id having sum(delta) < 0
        on conflict (order_id, product_id) where reason = 'restore' do nothing
        returning id`,
  );
  await tx.execute(sql`update orders set stock_applied = false where id = ${orderId}`);
  return put.length;
}
