import { sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { asOwner, type Db, type Tx } from "../db/client";
import { rows } from "../db/query";
import { HttpError } from "../http-error";
import { idParam, storeIdOf } from "./ids";
import { loadOrder, type Order } from "./orders";

// Payment is only ever marked received by the owner, one order at a time, and can be undone.
// Mounted at /v1/stores/:storeId
export function paymentsRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  async function inOrder(req: Request, fn: (tx: Tx, o: Order) => Promise<void>) {
    const storeId = storeIdOf(req);
    const orderId = idParam(req, "orderId", "Order");
    return asOwner(db, req.user!.id, async (tx) => {
      const o = await loadOrder(tx, storeId, orderId);
      if (!o) throw new HttpError(404, "Order not found.");
      await fn(tx, o);
      return loadOrder(tx, storeId, orderId);
    });
  }

  // "I can see the money": for an order the customer paid in advance.
  router.post("/orders/:orderId/payment/confirm", async (req, res) => {
    const order = await inOrder(req, async (tx, o) => {
      if (o.payment !== "paid") throw new HttpError(409, o.payment === "cod" ? "A cash-on-delivery order is settled when the rider hands over the cash." : "Mark the order as paid first.");
      if (o.status === "cancelled") throw new HttpError(409, "A cancelled order has no payment to confirm.");
      await tx.execute(sql`update orders set payment_confirmed_at = coalesce(payment_confirmed_at, now()) where id = ${o.id}`);
    });
    res.json({ order });
  });

  // The COD cash reached the store: from the rider on the day, or from the courier company days later. It does not
  // matter whether a rider was ever saved. The order's payment_confirmed_at is the one record of "the money is in".
  router.post("/orders/:orderId/payment/cash-handover", async (req, res) => {
    const order = await inOrder(req, async (tx, o) => {
      if (o.payment !== "cod") throw new HttpError(409, "Only a cash-on-delivery order has cash to collect.");
      if (o.status === "cancelled") throw new HttpError(409, "A cancelled order has no cash to collect.");
      await tx.execute(sql`update orders set payment_confirmed_at = coalesce(payment_confirmed_at, now()) where id = ${o.id}`);
    });
    res.json({ order });
  });

  // A correction: the money was not received after all.
  router.delete("/orders/:orderId/payment", async (req, res) => {
    const order = await inOrder(req, async (tx, o) => {
      await tx.execute(sql`update orders set payment_confirmed_at = null where id = ${o.id}`);
    });
    res.json({ order });
  });

  // Cash still to collect: COD orders that are out for delivery or delivered, from riders and from couriers, and not yet received.
  router.get("/cod-summary", async (req, res) => {
    const storeId = storeIdOf(req);
    const result = await asOwner(db, req.user!.id, async (tx) => {
      const list = await rows<{ id: string; orderNo: number; customerName: string; codAmount: number; riderName: string | null; deliveryKind: string; status: string; handedOver: boolean }>(
        tx,
        sql`select o.id, o.order_no, o.customer_name, o.cod_amount, d.rider_name, o.delivery_kind, o.status, o.payment_confirmed_at is not null as handed_over
              from orders o left join deliveries d on d.order_id = o.id
             where o.store_id = ${storeId} and o.payment = 'cod' and o.cod_amount > 0 and o.status in ('out_for_delivery', 'delivered')
             order by o.created_at desc limit 200`,
      );
      const expected = list.reduce((n, r) => n + r.codAmount, 0);
      const collected = list.filter((r) => r.handedOver).reduce((n, r) => n + r.codAmount, 0);
      return { expected, collected, outstanding: expected - collected, orders: list.filter((r) => !r.handedOver) };
    });
    res.json(result);
  });

  return router;
}
