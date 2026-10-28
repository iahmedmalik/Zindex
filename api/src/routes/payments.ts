import { sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import { asOwner, type Db, type Tx } from "../db/client";
import { rows } from "../db/query";
import { HttpError } from "../http-error";
import { validateBody } from "../validate";
import { idParam, storeIdOf } from "./ids";
import { loadOrder, type Order } from "./orders";

// The payment ledger. Every payment on an order is one row (order_payments): the amount, the method and the day it came
// in. What the shop expects is the cash-on-delivery amount for a COD order and the total for any other order; what is
// left is expected minus the payments. A customer who pays later can pay in chunks over days, and COD cash can come
// back from a rider or a courier in chunks. A payment is undone by deleting its row; amounts are never edited.
// orders.payment_confirmed_at is "fully paid at": set when the payments reach what is expected, cleared when they stop.
// Mounted at /v1/stores/:storeId

const payBody = z
  .object({
    amount: z.number().int().min(1).max(100_000_000),
    method: z.string().trim().min(1).max(40).nullable().optional(),
    note: z.string().trim().max(200).nullable().optional(),
    receivedOn: z.iso.date().optional(),
  })
  .strict();

type Payment = { id: string; amount: number; method: string | null; note: string | null; receivedOn: string; createdAt: Date };

const pkr = (n: number) => `PKR ${n.toLocaleString("en-US")}`;
const pkToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

async function listPayments(tx: Tx, orderId: string) {
  return rows<Payment>(tx, sql`select id, amount, method, note, to_char(received_on, 'YYYY-MM-DD') as received_on, created_at from order_payments where order_id = ${orderId} order by created_at, id`);
}

/** The order is fully paid once its payments reach what is expected. */
async function syncSettled(tx: Tx, orderId: string) {
  await tx.execute(
    sql`update orders o set payment_confirmed_at = case
          when (case when o.payment = 'cod' then o.cod_amount else o.total end) > 0
           and coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id), 0) >= (case when o.payment = 'cod' then o.cod_amount else o.total end)
          then coalesce(o.payment_confirmed_at, now()) else null end
        where o.id = ${orderId}`,
  );
}

async function record(tx: Tx, o: Order, b: { amount: number; method?: string | null; note?: string | null; receivedOn?: string }) {
  const balance = o.expected - o.paid;
  if (b.amount > balance) throw new HttpError(409, balance <= 0 ? "This order is already paid in full." : `That is more than the ${pkr(balance)} still to collect.`);
  if (b.receivedOn && b.receivedOn > pkToday()) throw new HttpError(400, "A payment cannot be dated in the future.");
  await tx.execute(
    sql`insert into order_payments (order_id, amount, method, note, received_on)
        values (${o.id}, ${b.amount}, ${b.method ?? o.paymentMethod ?? null}, ${b.note ?? null}, coalesce(${b.receivedOn ?? null}::date, (now() at time zone 'Asia/Karachi')::date))`,
  );
  await syncSettled(tx, o.id);
}

/** What the order page shows: the order with its fresh totals, and the list of payments. */
async function view(tx: Tx, storeId: string, orderId: string) {
  const order = (await loadOrder(tx, storeId, orderId))!;
  return { order, expected: order.expected, paid: order.paid, balance: Math.max(order.expected - order.paid, 0), payments: await listPayments(tx, orderId) };
}

export function paymentsRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  async function inOrder<T>(req: Request, fn: (tx: Tx, o: Order, storeId: string) => Promise<T>) {
    const storeId = storeIdOf(req);
    const orderId = idParam(req, "orderId", "Order");
    return asOwner(db, req.user!.id, async (tx) => {
      const o = await loadOrder(tx, storeId, orderId);
      if (!o) throw new HttpError(404, "Order not found.");
      return fn(tx, o, storeId);
    });
  }

  router.get("/orders/:orderId/payments", async (req, res) => {
    res.json(await inOrder(req, (tx, o, storeId) => view(tx, storeId, o.id)));
  });

  // Add a payment: any amount up to what is left. Cash on delivery can only come back once the order is out.
  router.post("/orders/:orderId/payments", validateBody(payBody), async (req, res) => {
    const b = req.body as z.infer<typeof payBody>;
    const result = await inOrder(req, async (tx, o, storeId) => {
      if (o.status === "cancelled" || o.status === "returned") throw new HttpError(409, `A ${o.status} order has no payment to record.`);
      if (o.payment === "cod" && o.status !== "out_for_delivery" && o.status !== "delivered") throw new HttpError(409, "The cash is with the rider or courier only once the order is out for delivery.");
      await record(tx, o, b);
      return view(tx, storeId, o.id);
    });
    res.status(201).json(result);
  });

  // Undo one payment.
  router.delete("/orders/:orderId/payments/:paymentId", async (req, res) => {
    const paymentId = idParam(req, "paymentId", "Payment");
    const result = await inOrder(req, async (tx, o, storeId) => {
      const gone = await rows<{ id: string }>(tx, sql`delete from order_payments where id = ${paymentId} and order_id = ${o.id} returning id`);
      if (gone.length === 0) throw new HttpError(404, "Payment not found.");
      await syncSettled(tx, o.id);
      return view(tx, storeId, o.id);
    });
    res.json(result);
  });

  // One tap: "I can see the money" for an order the customer paid in advance. Records what is left as one payment.
  router.post("/orders/:orderId/payment/confirm", async (req, res) => {
    const order = await inOrder(req, async (tx, o, storeId) => {
      if (o.payment !== "paid") throw new HttpError(409, o.payment === "cod" ? "A cash-on-delivery order is settled when the rider hands over the cash." : "Mark the order as paid first.");
      if (o.status === "cancelled") throw new HttpError(409, "A cancelled order has no payment to confirm.");
      if (o.expected - o.paid > 0) await record(tx, o, { amount: o.expected - o.paid });
      return (await loadOrder(tx, storeId, o.id))!;
    });
    res.json({ order });
  });

  // One tap: the rider or courier gave the store the COD cash. Records what is left as one payment.
  router.post("/orders/:orderId/payment/cash-handover", async (req, res) => {
    const order = await inOrder(req, async (tx, o, storeId) => {
      if (o.payment !== "cod") throw new HttpError(409, "Only a cash-on-delivery order has cash to collect.");
      if (o.status === "cancelled") throw new HttpError(409, "A cancelled order has no cash to collect.");
      if (o.expected - o.paid > 0) await record(tx, o, { amount: o.expected - o.paid });
      return (await loadOrder(tx, storeId, o.id))!;
    });
    res.json({ order });
  });

  // A correction: none of the money was received after all. Removes every payment on the order.
  router.delete("/orders/:orderId/payment", async (req, res) => {
    const order = await inOrder(req, async (tx, o, storeId) => {
      await tx.execute(sql`delete from order_payments where order_id = ${o.id}`);
      await syncSettled(tx, o.id);
      return (await loadOrder(tx, storeId, o.id))!;
    });
    res.json({ order });
  });

  // Cash to collect, in three buckets: with riders (COD by rider), from customers (pay later, once delivered) and from
  // couriers (COD by courier). Each order still owing money is listed with what is left and how long ago it was delivered.
  router.get("/cod-summary", async (req, res) => {
    const storeId = storeIdOf(req);
    const result = await asOwner(db, req.user!.id, async (tx) => {
      const list = await rows<{
        id: string; orderNo: number; customerName: string; customerPhone: string | null; codAmount: number; riderName: string | null; deliveryKind: string;
        payment: string; status: string; deliveredAt: Date | null; expected: number; paid: number;
      }>(
        tx,
        sql`select o.id, o.order_no, o.customer_name, o.customer_phone, o.cod_amount, d.rider_name, o.delivery_kind, o.payment, o.status, o.delivered_at,
                   case when o.payment = 'cod' then o.cod_amount else o.total end as expected,
                   coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id), 0)::int as paid
              from orders o left join deliveries d on d.order_id = o.id
             where o.store_id = ${storeId}
               and ((o.payment = 'cod' and o.cod_amount > 0 and o.status in ('out_for_delivery', 'delivered')) or (o.payment = 'unpaid' and o.status = 'delivered'))
             order by o.created_at desc limit 300`,
      );
      const bucketOf = (r: { payment: string; deliveryKind: string }) => (r.payment === "unpaid" ? "customers" : r.deliveryKind === "courier" ? "couriers" : r.deliveryKind === "local" ? "riders" : "customers");
      const owing = list.map((r) => ({ ...r, balance: Math.max(r.expected - r.paid, 0), bucket: bucketOf(r) })).filter((r) => r.balance > 0);
      const buckets = { riders: { orders: 0, amount: 0 }, customers: { orders: 0, amount: 0 }, couriers: { orders: 0, amount: 0 } };
      for (const r of owing) { buckets[r.bucket as keyof typeof buckets].orders++; buckets[r.bucket as keyof typeof buckets].amount += r.balance; }
      const expected = list.reduce((n, r) => n + r.expected, 0);
      const collected = list.reduce((n, r) => n + Math.min(r.paid, r.expected), 0);
      return { expected, collected, outstanding: expected - collected, buckets, orders: owing };
    });
    res.json(result);
  });

  return router;
}
