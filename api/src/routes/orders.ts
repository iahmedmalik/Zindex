import { sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { ensureCard } from "../cards/token";
import type { Config } from "../config";
import { asOwner, type Db, type Tx } from "../db/client";
import { pgCode, rows, textArray } from "../db/query";
import { HttpError } from "../http-error";
import { calculateTotals, lineDiscount } from "../invoice/totals";
import { canMove, stages, type Stage } from "../orders/stages";
import { createInvoice, recordInvoiceEdit } from "./invoices";
import { adjustForEdit, deductForOrder, restoreForOrder, type StockWarning } from "../stock/ledger";
import { normalisePhone } from "../phone";
import { validateBody } from "../validate";
import { idParam, storeIdOf } from "./ids";

const money = z.number().int().min(0).max(100_000_000);

const itemBody = z
  .object({
    productId: z.uuid().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    quantity: z.number().int().min(1).max(10_000),
    unitPrice: money.optional(),
    // The cost of one piece, optional. Left out, a product line takes the product's cost as it is today and a typed
    // line has none (unknown): it is left out of profit until the owner fills it in.
    unitCost: money.nullable().optional(),
    // A discount on this one item: a percent of the line, or rupees off the whole line (quantity x price).
    discount: z.object({ kind: z.enum(["percent", "amount"]), value: money }).strict().nullable().optional(),
  })
  .strict();

const fields = {
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z
    .string()
    .trim()
    .transform(normalisePhone)
    .refine((p) => /^[0-9]{7,15}$/.test(p), "enter a phone number with 7 to 15 digits")
    .nullable(),
  address: z.string().trim().max(300).nullable(),
  items: z.array(itemBody).min(1).max(60),
  discountPercent: z.number().int().min(0).max(100),
  deliveryCharge: money,
  riderFee: money,
  deliveryPaidBy: z.enum(["customer", "store"]),
  pickupMapUrl: z.string().trim().url().regex(/^https:\/\//, "use a https:// link").max(500).nullable(),
  deliveryKind: z.enum(["local", "courier", "pickup"]),
  payment: z.enum(["paid", "cod", "unpaid"]),
  paymentMethod: z.string().trim().min(1).max(40).nullable(),
  notes: z.string().trim().max(500).nullable(),
  source: z.enum(["whatsapp", "manual"]),
  idempotencyKey: z.string().min(8).max(80),
};

const createBody = z
  .object({ customerName: fields.customerName, items: fields.items })
  .extend({
    customerPhone: fields.customerPhone.optional(),
    address: fields.address.optional(),
    discountPercent: fields.discountPercent.optional(),
    deliveryCharge: fields.deliveryCharge.optional(),
    riderFee: fields.riderFee.optional(),
    deliveryPaidBy: fields.deliveryPaidBy.optional(),
    pickupMapUrl: fields.pickupMapUrl.optional(),
    deliveryKind: fields.deliveryKind.optional(),
    payment: fields.payment.optional(),
    paymentMethod: fields.paymentMethod.optional(),
    notes: fields.notes.optional(),
    source: fields.source.optional(),
    idempotencyKey: fields.idempotencyKey.optional(),
  })
  .strict();
const updateBody = createBody.omit({ idempotencyKey: true, source: true }).partial().strict();
const statusBody = z.object({ status: z.enum(stages) }).strict();

export type ItemDiscount = { kind: "percent" | "amount"; value: number };
export type OrderItem = { id: string; productId: string | null; name: string; quantity: number; unitPrice: number; unitCost: number | null; discountKind: ItemDiscount["kind"] | null; discountValue: number | null; discountAmount: number };
export type Order = {
  id: string;
  storeId: string;
  orderNo: number;
  customerId: string | null;
  customerName: string;
  customerPhone: string | null;
  address: string | null;
  source: string;
  status: Stage;
  deliveryKind: string;
  payment: string;
  paymentMethod: string | null;
  discountPercent: number;
  deliveryCharge: number;
  riderFee: number;
  deliveryPaidBy: "customer" | "store";
  pickupMapUrl: string | null;
  subtotal: number;
  discount: number;
  total: number;
  codAmount: number;
  collectAtDoor: number;
  amountDue: number;
  notes: string | null;
  stockApplied: boolean;
  paymentConfirmedAt: Date | null;
  /** What the shop expects to collect on this order: the cash-on-delivery amount for COD, the total otherwise. */
  expected: number;
  /** What has been paid so far (the sum of the order's payments). */
  paid: number;
  deliveredAt: Date | null;
  externalRef: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItem[];
};

const orderSelect = sql`
  o.id, o.store_id, o.order_no, o.customer_id, o.customer_name, o.customer_phone, o.address, o.source, o.status,
  o.delivery_kind, o.payment, o.payment_method, o.discount_percent, o.delivery_charge, o.rider_fee, o.delivery_paid_by, o.pickup_map_url, o.subtotal,
  o.discount, o.total, o.cod_amount, o.collect_at_door, o.amount_due, o.notes, o.stock_applied, o.payment_confirmed_at, o.delivered_at, o.external_ref, o.created_at, o.updated_at,
  case when o.payment = 'cod' then o.cod_amount else o.total end as expected,
  coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id), 0)::int as paid,
  coalesce((select json_agg(json_build_object('id', i.id, 'productId', i.product_id, 'name', i.name,
                                              'quantity', i.quantity, 'unitPrice', i.unit_price, 'unitCost', i.unit_cost,
                                              'discountKind', i.discount_kind, 'discountValue', i.discount_value, 'discountAmount', i.discount_amount) order by i.position)
              from order_items i where i.order_id = o.id), '[]'::json) as items`;

export async function loadOrder(tx: Tx, storeId: string, id: string): Promise<Order | undefined> {
  const [order] = await rows<Order>(tx, sql`select ${orderSelect} from orders o where o.id = ${id} and o.store_id = ${storeId}`);
  return order;
}

type ItemInput = z.infer<typeof itemBody>;
type Resolved = { productId: string | null; name: string; quantity: number; unitPrice: number; unitCost: number | null; discount: ItemDiscount | null; discountAmount: number };

// Items can name a product (name, price and cost come from the store's catalogue unless overridden)
// or be typed by hand (name and price required, cost optional).
// The cost is saved on the line when the order is made, so a product's cost changing later never changes an old
// sale. `previous` is the order's own earlier lines (when a pending order is edited): an unchanged line keeps the cost
// it already had instead of picking up today's.
async function resolveItems(tx: Tx, storeId: string, items: ItemInput[], previous: OrderItem[] = []): Promise<Resolved[]> {
  const out: Resolved[] = [];
  for (const item of items) {
    let line: Omit<Resolved, "discount" | "discountAmount">;
    if (item.productId) {
      const [p] = await rows<{ name: string; price: number; cost: number | null }>(tx, sql`select name, price, cost from products where id = ${item.productId} and store_id = ${storeId}`);
      if (!p) throw new HttpError(400, "One of the products is not in this store.");
      const kept = previous.find((l) => l.productId === item.productId && l.unitCost !== null);
      line = { productId: item.productId, name: item.name ?? p.name, quantity: item.quantity, unitPrice: item.unitPrice ?? p.price, unitCost: item.unitCost !== undefined ? item.unitCost : (kept?.unitCost ?? p.cost) };
    } else {
      if (!item.name || item.unitPrice === undefined) throw new HttpError(400, "A typed item needs a name and a price.");
      const kept = previous.find((l) => l.productId === null && l.name === item.name && l.unitCost !== null);
      line = { productId: null, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, unitCost: item.unitCost !== undefined ? item.unitCost : (kept?.unitCost ?? null) };
    }
    const discount = item.discount && item.discount.value > 0 ? item.discount : null;
    let discountAmount = 0;
    try {
      discountAmount = lineDiscount({ quantity: line.quantity, unitPrice: line.unitPrice, discount });
    } catch (err) {
      throw new HttpError(400, `${line.name}: ${err instanceof Error ? err.message : "the discount is not valid."}`);
    }
    out.push({ ...line, discount, discountAmount });
  }
  return out;
}

// A pickup has no delivery to pay for, so it is always "customer" (the default, which changes nothing).
const paidBy = (kind: string, choice: "customer" | "store" | undefined): "customer" | "store" => (kind === "pickup" ? "customer" : (choice ?? "customer"));

function totalsFor(items: Resolved[], v: { discountPercent: number; deliveryCharge: number; riderFee: number; payment: "paid" | "cod" | "unpaid"; deliveryPaidBy: "customer" | "store" }) {
  try {
    return calculateTotals({
      lines: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount })),
      discount: v.discountPercent > 0 ? { kind: "percent", percent: v.discountPercent } : { kind: "none" },
      deliveryCharge: v.deliveryCharge,
      riderFee: v.riderFee,
      payment: v.payment,
      deliveryPaidBy: v.deliveryPaidBy,
    });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "The amounts are not valid.");
  }
}

// Saves (or finds) the customer for an order so the next order from the same person is one tap. With a phone the
// customer is found by phone; with only a name, by name (a name-only customer is one per store).
async function saveCustomer(tx: Tx, storeId: string, name: string, phone: string | null, address: string | null): Promise<string | null> {
  const addresses = textArray(address ? [address] : []);
  const [c] = phone
    ? await rows<{ id: string }>(
        tx,
        sql`insert into customers (store_id, name, phone, addresses)
            values (${storeId}, ${name}, ${phone}, ${addresses})
            on conflict (store_id, phone) do update set
              name = excluded.name,
              addresses = (select coalesce(array_agg(distinct a), '{}') from unnest(customers.addresses || excluded.addresses) a),
              updated_at = now()
            returning id`,
      )
    : await rows<{ id: string }>(
        tx,
        sql`insert into customers (store_id, name, phone, addresses)
            values (${storeId}, ${name}, null, ${addresses})
            on conflict (store_id, lower(name)) where phone is null do update set
              addresses = (select coalesce(array_agg(distinct a), '{}') from unnest(customers.addresses || excluded.addresses) a),
              updated_at = now()
            returning id`,
      );
  return c?.id ?? null;
}

async function writeItems(tx: Tx, orderId: string, items: Resolved[]) {
  await tx.execute(sql`delete from order_items where order_id = ${orderId}`);
  for (const [position, i] of items.entries()) {
    await tx.execute(
      sql`insert into order_items (order_id, product_id, position, name, quantity, unit_price, unit_cost, discount_kind, discount_value, discount_amount)
          values (${orderId}, ${i.productId}, ${position}, ${i.name}, ${i.quantity}, ${i.unitPrice}, ${i.unitCost}, ${i.discount?.kind ?? null}, ${i.discount?.value ?? null}, ${i.discountAmount})`,
    );
  }
}

/** What deleting an order will take with it, shown on the confirm card. */
type DeleteInfo = { stockOut: boolean; payments: number; invoiceNumber: string | null; numberComesBack: boolean };

/**
 * Any order can be deleted, at any stage (the owner's call). Its invoice, items, payments, delivery link and parcel go with
 * it. If its invoice is the store's latest number the number is given back, so no gap appears; an older number stays
 * missing, and the confirm card says so. Cancel is still there for an order that should stay on record as void.
 */
async function deleteInfo(tx: Tx, storeId: string, o: Order): Promise<DeleteInfo & { invoiceSeq: number | null }> {
  const [inv] = await rows<{ number: string | null }>(tx, sql`select number from invoices where order_id = ${o.id}`);
  const [st] = await rows<{ nextInvoiceNo: number }>(tx, sql`select next_invoice_no from stores where id = ${storeId}`);
  const seq = inv?.number ? Number(inv.number.split("-").pop()) : NaN;
  const latest = Number.isInteger(seq) && !!st && seq === st.nextInvoiceNo - 1;
  const [net] = await rows<{ net: number }>(tx, sql`select coalesce(sum(delta), 0)::int as net from stock_movements where order_id = ${o.id}`);
  return {
    stockOut: (net?.net ?? 0) < 0,
    payments: o.paid,
    invoiceNumber: inv?.number ?? null,
    numberComesBack: latest,
    invoiceSeq: latest ? seq : null,
  };
}

const deleteBody = z.object({ restoreStock: z.boolean().optional() }).strict();

export type NewOrder = Omit<z.infer<typeof createBody>, "source" | "idempotencyKey"> & { source?: "whatsapp" | "manual" | "shopify"; externalRef?: string | null };

/** Saves one new order: resolves the items, works out the totals, saves the customer and takes the next order number. */
export async function insertOrder(tx: Tx, storeId: string, b: NewOrder, key: string | null = null): Promise<string> {
  const items = await resolveItems(tx, storeId, b.items);
  const v = { discountPercent: b.discountPercent ?? 0, deliveryCharge: b.deliveryCharge ?? 0, riderFee: b.riderFee ?? 0, payment: b.payment ?? "cod", deliveryPaidBy: paidBy(b.deliveryKind ?? "local", b.deliveryPaidBy) };
  const t = totalsFor(items, v);
  const phone = b.customerPhone ?? null;
  const customerId = await saveCustomer(tx, storeId, b.customerName, phone, b.address ?? null);
  const orderNo = (await rows<{ orderNo: number }>(tx, sql`select allocate_order_no(${storeId}) as order_no`))[0]!.orderNo;
  const id = (await rows<{ id: string }>(
    tx,
    sql`insert into orders (store_id, order_no, customer_id, customer_name, customer_phone, address, source, delivery_kind, payment,
          payment_method, discount_percent, delivery_charge, rider_fee, delivery_paid_by, pickup_map_url, subtotal, discount, total, cod_amount, collect_at_door,
          amount_due, notes, idempotency_key, external_ref)
        values (${storeId}, ${orderNo}, ${customerId}, ${b.customerName}, ${phone}, ${b.address ?? null}, ${b.source ?? "whatsapp"},
          ${b.deliveryKind ?? "local"}, ${v.payment}, ${b.paymentMethod ?? null}, ${v.discountPercent}, ${v.deliveryCharge}, ${v.riderFee}, ${v.deliveryPaidBy}, ${(b.deliveryKind ?? "local") === "pickup" ? (b.pickupMapUrl ?? null) : null},
          ${t.subtotal}, ${t.discount}, ${t.total}, ${t.codAmount}, ${t.collectAtDoor}, ${t.amountDue}, ${b.notes ?? null}, ${key}, ${b.externalRef ?? null})
        returning id`,
  ))[0]!.id;
  await writeItems(tx, id, items);
  await createInvoice(tx, storeId, id); // the invoice is made with the order, with the store's next number
  return id;
}

// Mounted at /v1/stores/:storeId/orders
export function ordersRouter(db: Db, config: Config): Router {
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const storeId = storeIdOf(req);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const digits = normalisePhone(q);
    const status = typeof req.query.status === "string" ? req.query.status : "";
    if (status && !(stages as readonly string[]).includes(status)) throw new HttpError(400, "Unknown status.");
    // "pickup=1" keeps pickup orders only, "pickup=0" leaves them out: Out for delivery / Ready for pickup (and Delivered / Picked up) are the same stored status.
    const pickup = req.query.pickup === "1" ? "1" : req.query.pickup === "0" ? "0" : "";
    const payment = typeof req.query.payment === "string" ? req.query.payment : "";
    if (payment && !["paid", "cod", "unpaid"].includes(payment)) throw new HttpError(400, "Unknown payment.");
    const method = typeof req.query.method === "string" ? req.query.method : "";
    // The views the Today tiles open (same rules as the dashboard counts).
    const view = typeof req.query.view === "string" ? req.query.view : "";
    const bucket = typeof req.query.bucket === "string" ? req.query.bucket : "";
    if (bucket && !["riders", "customers", "couriers"].includes(bucket)) throw new HttpError(400, "Unknown bucket.");
    if (view && !["needs_rider", "cash", "delivered_today"].includes(view)) throw new HttpError(400, "Unknown view.");
    const list = await asOwner(db, req.user!.id, (tx) =>
      rows<Order>(
        tx,
        sql`select ${orderSelect} from orders o
            where o.store_id = ${storeId}
              and (${status} = '' or o.status = ${status})
              and (${pickup} = '' or (${pickup} = '1') = (o.delivery_kind = 'pickup'))
              and (${payment} = '' or o.payment = ${payment})
              and (${method} = '' or o.payment_method = ${method})
              and (${view} <> 'needs_rider' or (o.status = 'packed' and o.delivery_kind = 'local'
                   and not exists (select 1 from deliveries d where d.order_id = o.id and d.rider_name is not null)))
              and (${view} <> 'cash' or (
                    ((o.payment = 'cod' and o.cod_amount > 0 and o.status in ('out_for_delivery', 'delivered')) or (o.payment = 'unpaid' and o.status = 'delivered'))
                    and (case when o.payment = 'cod' then o.cod_amount else o.total end) > coalesce((select sum(p.amount) from order_payments p where p.order_id = o.id), 0)
                    and (${bucket} = '' or ${bucket} = (case when o.payment = 'unpaid' then 'customers' when o.delivery_kind = 'courier' then 'couriers' when o.delivery_kind = 'local' then 'riders' else 'customers' end))))
              and (${view} <> 'delivered_today' or (o.status = 'delivered'
                   and (o.created_at at time zone 'Asia/Karachi')::date = (now() at time zone 'Asia/Karachi')::date))
              and (${q} = '' or o.customer_name ilike ${"%" + q + "%"}
                   or (${digits} <> '' and o.customer_phone like ${"%" + digits + "%"})
                   or o.order_no::text = ${q.replace(/^#/, "")})
            order by o.created_at desc limit 100`,
      ),
    );
    res.json({ orders: list });
  });

  router.get("/:id", async (req, res) => {
    const found = await asOwner(db, req.user!.id, async (tx) => {
      const order = await loadOrder(tx, storeIdOf(req), idParam(req, "id", "Order"));
      return order ? { order, onDelete: await deleteInfo(tx, storeIdOf(req), order) } : null;
    });
    if (!found) throw new HttpError(404, "Order not found.");
    const { invoiceSeq: _seq, ...onDelete } = found.onDelete;
    res.json({ order: found.order, onDelete });
  });

  // The order, its invoice, items, payments, delivery link and parcel go. Stock it took out is put back unless the owner
  // says the goods really are gone (restoreStock: false): then the ledger keeps the loss as an adjustment, so the stock
  // level does not change. The invoice number is given back when it was the latest.
  router.delete("/:id", (req, _res, next) => { req.body ??= {}; next(); }, validateBody(deleteBody), async (req, res) => {
    const storeId = storeIdOf(req);
    const id = idParam(req, "id", "Order");
    const { restoreStock = true } = req.body as z.infer<typeof deleteBody>;
    const result = await asOwner(db, req.user!.id, async (tx) => {
      const order = await loadOrder(tx, storeId, id);
      if (!order) throw new HttpError(404, "Order not found.");
      const info = await deleteInfo(tx, storeId, order);
      if (info.stockOut && !restoreStock) {
        await tx.execute(
          sql`insert into stock_movements (store_id, product_id, delta, reason, note)
              select ${storeId}, product_id, sum(delta)::int, 'adjustment', ${`Order #${order.orderNo} deleted, stock not put back`}
                from stock_movements where order_id = ${id} group by product_id having sum(delta) <> 0`,
        );
      }
      await tx.execute(sql`delete from orders where id = ${id}`); // the order's own stock rows go with it: that is what puts the stock back
      let released = false;
      if (info.invoiceSeq !== null) {
        const [r] = await rows<{ ok: boolean }>(tx, sql`select release_invoice_number(${storeId}::uuid, ${info.invoiceSeq}::int) as ok`);
        if (!r?.ok) throw new HttpError(409, "Another order was made at the same moment, so its invoice number could not be given back. Nothing was deleted. Try again.");
        released = true;
      }
      return { deleted: true, invoiceNumberReleased: released, stockPutBack: info.stockOut && restoreStock };
    });
    res.json(result);
  });

  router.post("/", validateBody(createBody), async (req, res) => {
    const b = req.body as z.infer<typeof createBody>;
    const storeId = storeIdOf(req);
    const key = b.idempotencyKey ?? null;
    const existing = (tx: Tx) =>
      key ? rows<{ id: string }>(tx, sql`select id from orders where store_id = ${storeId} and idempotency_key = ${key}`) : Promise.resolve([]);

    try {
      const result = await asOwner(db, req.user!.id, async (tx) => {
        const [again] = await existing(tx);
        if (again) return { order: await loadOrder(tx, storeId, again.id), created: false };

        const id = await insertOrder(tx, storeId, b, key);
        return { order: await loadOrder(tx, storeId, id), created: true };
      });
      res.status(result.created ? 201 : 200).json({ order: result.order });
    } catch (err) {
      const code = pgCode(err);
      if (code === "42501" || code === "P0002" || code === "23503") throw new HttpError(404, "Store not found.");
      // Two copies of the same retried request raced each other; the loser returns the winner's order.
      if (code === "23505" && key) {
        const order = await asOwner(db, req.user!.id, async (tx) => {
          const [again] = await existing(tx);
          return again ? loadOrder(tx, storeId, again.id) : undefined;
        });
        if (order) return void res.status(200).json({ order });
      }
      throw err;
    }
  });

  // Editing works at any stage except cancelled or returned: every total is worked out again and the status stays. If the
  // order already took stock out, the change in items moves the stock by the difference (an 'edit' movement). Payments
  // already recorded stay; if the new total is lower the order simply shows as overpaid.
  router.patch("/:id", validateBody(updateBody), async (req, res) => {
    const b = req.body as z.infer<typeof updateBody>;
    const storeId = storeIdOf(req);
    const id = idParam(req, "id", "Order");
    const order = await asOwner(db, req.user!.id, async (tx) => {
      const current = await loadOrder(tx, storeId, id);
      if (!current) throw new HttpError(404, "Order not found.");
      if (current.status === "cancelled" || current.status === "returned") throw new HttpError(409, `A ${current.status} order cannot be edited.`);
      const items = b.items ? await resolveItems(tx, storeId, b.items, current.items) : current.items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, unitCost: i.unitCost, discount: i.discountKind && i.discountValue !== null ? { kind: i.discountKind, value: i.discountValue } : null, discountAmount: i.discountAmount }));
      const v = {
        discountPercent: b.discountPercent ?? current.discountPercent,
        deliveryCharge: b.deliveryCharge ?? current.deliveryCharge,
        riderFee: b.riderFee ?? current.riderFee,
        deliveryPaidBy: paidBy(b.deliveryKind ?? current.deliveryKind, b.deliveryPaidBy ?? current.deliveryPaidBy),
        payment: (b.payment ?? current.payment) as "paid" | "cod" | "unpaid",
      };
      const t = totalsFor(items, v);
      const name = b.customerName ?? current.customerName;
      const phone = "customerPhone" in b ? (b.customerPhone ?? null) : current.customerPhone;
      const address = "address" in b ? (b.address ?? null) : current.address;
      const customerId = "customerPhone" in b || "customerName" in b ? await saveCustomer(tx, storeId, name, phone, address) : current.customerId;

      await tx.execute(
        sql`update orders set customer_id = ${customerId}, customer_name = ${name}, customer_phone = ${phone}, address = ${address},
              delivery_kind = ${b.deliveryKind ?? current.deliveryKind}, payment = ${v.payment},
              payment_method = ${"paymentMethod" in b ? (b.paymentMethod ?? null) : current.paymentMethod},
              discount_percent = ${v.discountPercent}, delivery_charge = ${v.deliveryCharge}, rider_fee = ${v.riderFee}, delivery_paid_by = ${v.deliveryPaidBy},
              pickup_map_url = ${(b.deliveryKind ?? current.deliveryKind) === "pickup" ? ("pickupMapUrl" in b ? (b.pickupMapUrl ?? null) : current.pickupMapUrl) : null},
              subtotal = ${t.subtotal}, discount = ${t.discount}, total = ${t.total}, cod_amount = ${t.codAmount},
              collect_at_door = ${t.collectAtDoor}, amount_due = ${t.amountDue},
              notes = ${"notes" in b ? (b.notes ?? null) : current.notes}, updated_at = now()
            where id = ${id}`,
      );
      if (b.items) {
        if (current.stockApplied) {
          try {
            await adjustForEdit(tx, storeId, id, current.orderNo, current.items, items);
          } catch (err) {
            // 23514: the database does not know the 'edit' stock movement yet (migration 025 not run). Nothing was saved.
            if (pgCode(err) === "23514") throw new HttpError(409, "Changing the items of a confirmed order needs the latest database update (025), which has not been run yet. Nothing was changed.");
            throw err;
          }
        }
        await writeItems(tx, id, items);
      }
      const saved = await loadOrder(tx, storeId, id);
      await recordInvoiceEdit(tx, current, saved!);
      return saved;
    });
    res.json({ order });
  });

  router.post("/:id/status", validateBody(statusBody), async (req, res) => {
    const { status } = req.body as z.infer<typeof statusBody>;
    const storeId = storeIdOf(req);
    const id = idParam(req, "id", "Order");
    const order = await asOwner(db, req.user!.id, async (tx) => {
      const current = await loadOrder(tx, storeId, id);
      if (!current) throw new HttpError(404, "Order not found.");
      if (!canMove(current.status, status)) throw new HttpError(409, `An order that is ${current.status.replace(/_/g, " ")} cannot become ${status.replace(/_/g, " ")}.`);
      await tx.execute(sql`update orders set status = ${status}, updated_at = now(), delivered_at = case when ${status} = 'delivered' then now() else delivered_at end where id = ${id}`);
      // Confirming is the one moment stock moves. A zero-stock sale still goes through; the
      // warning tells the owner which products are now below zero.
      const stockWarnings: StockWarning[] = status === "confirmed" ? await deductForOrder(tx, storeId, id) : [];
      // The customer's delivery card link is made by itself at this moment; the owner only has to send it.
      if (status === "confirmed") await ensureCard(tx, config.BETTER_AUTH_SECRET, config.WEB_ORIGIN, id);
      return { order: await loadOrder(tx, storeId, id), stockWarnings };
    });
    res.json(order);
  });

  // The owner approves putting a cancelled or returned order's stock back. Never automatic.
  router.post("/:id/restore-stock", async (req, res) => {
    const storeId = storeIdOf(req);
    const id = idParam(req, "id", "Order");
    const result = await asOwner(db, req.user!.id, async (tx) => {
      const current = await loadOrder(tx, storeId, id);
      if (!current) throw new HttpError(404, "Order not found.");
      if (current.status !== "cancelled" && current.status !== "returned") throw new HttpError(409, "Only a cancelled or returned order can have its stock put back.");
      if (!current.stockApplied) throw new HttpError(409, "This order has no deducted stock to put back.");
      const restored = await restoreForOrder(tx, storeId, id);
      return { order: await loadOrder(tx, storeId, id), restored };
    });
    res.json(result);
  });

  return router;
}
