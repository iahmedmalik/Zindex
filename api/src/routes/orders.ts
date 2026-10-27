import { sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { asOwner, type Db, type Tx } from "../db/client";
import { pgCode, rows, textArray } from "../db/query";
import { HttpError } from "../http-error";
import { calculateTotals } from "../invoice/totals";
import { canMove, stages, type Stage } from "../orders/stages";
import { deductForOrder, restoreForOrder, type StockWarning } from "../stock/ledger";
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

export type OrderItem = { id: string; productId: string | null; name: string; quantity: number; unitPrice: number };
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
  subtotal: number;
  discount: number;
  total: number;
  codAmount: number;
  collectAtDoor: number;
  amountDue: number;
  notes: string | null;
  stockApplied: boolean;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItem[];
};

const orderSelect = sql`
  o.id, o.store_id, o.order_no, o.customer_id, o.customer_name, o.customer_phone, o.address, o.source, o.status,
  o.delivery_kind, o.payment, o.payment_method, o.discount_percent, o.delivery_charge, o.rider_fee, o.subtotal,
  o.discount, o.total, o.cod_amount, o.collect_at_door, o.amount_due, o.notes, o.stock_applied, o.created_at, o.updated_at,
  coalesce((select json_agg(json_build_object('id', i.id, 'productId', i.product_id, 'name', i.name,
                                              'quantity', i.quantity, 'unitPrice', i.unit_price) order by i.position)
              from order_items i where i.order_id = o.id), '[]'::json) as items`;

export async function loadOrder(tx: Tx, storeId: string, id: string): Promise<Order | undefined> {
  const [order] = await rows<Order>(tx, sql`select ${orderSelect} from orders o where o.id = ${id} and o.store_id = ${storeId}`);
  return order;
}

type ItemInput = z.infer<typeof itemBody>;
type Resolved = { productId: string | null; name: string; quantity: number; unitPrice: number };

// Items can name a product (name and price come from the store's catalogue unless overridden)
// or be typed by hand (name and price required).
async function resolveItems(tx: Tx, storeId: string, items: ItemInput[]): Promise<Resolved[]> {
  const out: Resolved[] = [];
  for (const item of items) {
    if (item.productId) {
      const [p] = await rows<{ name: string; price: number }>(tx, sql`select name, price from products where id = ${item.productId} and store_id = ${storeId}`);
      if (!p) throw new HttpError(400, "One of the products is not in this store.");
      out.push({ productId: item.productId, name: item.name ?? p.name, quantity: item.quantity, unitPrice: item.unitPrice ?? p.price });
    } else {
      if (!item.name || item.unitPrice === undefined) throw new HttpError(400, "A typed item needs a name and a price.");
      out.push({ productId: null, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice });
    }
  }
  return out;
}

function totalsFor(items: Resolved[], v: { discountPercent: number; deliveryCharge: number; riderFee: number; payment: "paid" | "cod" | "unpaid" }) {
  try {
    return calculateTotals({
      lines: items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice })),
      discount: v.discountPercent > 0 ? { kind: "percent", percent: v.discountPercent } : { kind: "none" },
      deliveryCharge: v.deliveryCharge,
      riderFee: v.riderFee,
      payment: v.payment,
    });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "The amounts are not valid.");
  }
}

// Saves (or finds) the customer for an order so the next order from the same phone is one tap.
async function saveCustomer(tx: Tx, storeId: string, name: string, phone: string | null, address: string | null): Promise<string | null> {
  if (!phone) return null;
  const [c] = await rows<{ id: string }>(
    tx,
    sql`insert into customers (store_id, name, phone, addresses)
        values (${storeId}, ${name}, ${phone}, ${textArray(address ? [address] : [])})
        on conflict (store_id, phone) do update set
          name = excluded.name,
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
      sql`insert into order_items (order_id, product_id, position, name, quantity, unit_price) values (${orderId}, ${i.productId}, ${position}, ${i.name}, ${i.quantity}, ${i.unitPrice})`,
    );
  }
}

// Mounted at /v1/stores/:storeId/orders
export function ordersRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const storeId = storeIdOf(req);
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const digits = normalisePhone(q);
    const status = typeof req.query.status === "string" ? req.query.status : "";
    if (status && !(stages as readonly string[]).includes(status)) throw new HttpError(400, "Unknown status.");
    const list = await asOwner(db, req.user!.id, (tx) =>
      rows<Order>(
        tx,
        sql`select ${orderSelect} from orders o
            where o.store_id = ${storeId}
              and (${status} = '' or o.status = ${status})
              and (${q} = '' or o.customer_name ilike ${"%" + q + "%"}
                   or (${digits} <> '' and o.customer_phone like ${"%" + digits + "%"})
                   or o.order_no::text = ${q.replace(/^#/, "")})
            order by o.created_at desc limit 100`,
      ),
    );
    res.json({ orders: list });
  });

  router.get("/:id", async (req, res) => {
    const order = await asOwner(db, req.user!.id, (tx) => loadOrder(tx, storeIdOf(req), idParam(req, "id", "Order")));
    if (!order) throw new HttpError(404, "Order not found.");
    res.json({ order });
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

        const items = await resolveItems(tx, storeId, b.items);
        const v = { discountPercent: b.discountPercent ?? 0, deliveryCharge: b.deliveryCharge ?? 0, riderFee: b.riderFee ?? 0, payment: b.payment ?? "cod" };
        const t = totalsFor(items, v);
        const phone = b.customerPhone ?? null;
        const customerId = await saveCustomer(tx, storeId, b.customerName, phone, b.address ?? null);
        const orderNo = (await rows<{ orderNo: number }>(tx, sql`select allocate_order_no(${storeId}) as order_no`))[0]!.orderNo;
        const id = (await rows<{ id: string }>(
          tx,
          sql`insert into orders (store_id, order_no, customer_id, customer_name, customer_phone, address, source, delivery_kind, payment,
                payment_method, discount_percent, delivery_charge, rider_fee, subtotal, discount, total, cod_amount, collect_at_door,
                amount_due, notes, idempotency_key)
              values (${storeId}, ${orderNo}, ${customerId}, ${b.customerName}, ${phone}, ${b.address ?? null}, ${b.source ?? "whatsapp"},
                ${b.deliveryKind ?? "local"}, ${v.payment}, ${b.paymentMethod ?? null}, ${v.discountPercent}, ${v.deliveryCharge}, ${v.riderFee},
                ${t.subtotal}, ${t.discount}, ${t.total}, ${t.codAmount}, ${t.collectAtDoor}, ${t.amountDue}, ${b.notes ?? null}, ${key})
              returning id`,
        ))[0]!.id;
        await writeItems(tx, id, items);
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

  // Editing recalculates every total. Once an order is confirmed its items are locked (the stock
  // has moved); everything else can still be corrected.
  router.patch("/:id", validateBody(updateBody), async (req, res) => {
    const b = req.body as z.infer<typeof updateBody>;
    const storeId = storeIdOf(req);
    const id = idParam(req, "id", "Order");
    const order = await asOwner(db, req.user!.id, async (tx) => {
      const current = await loadOrder(tx, storeId, id);
      if (!current) throw new HttpError(404, "Order not found.");
      if (current.status === "cancelled" || current.status === "returned") throw new HttpError(409, `A ${current.status} order cannot be edited.`);
      if (b.items && current.stockApplied) throw new HttpError(409, "The items are locked once the order is confirmed.");

      const items = b.items ? await resolveItems(tx, storeId, b.items) : current.items.map((i) => ({ productId: i.productId, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice }));
      const v = {
        discountPercent: b.discountPercent ?? current.discountPercent,
        deliveryCharge: b.deliveryCharge ?? current.deliveryCharge,
        riderFee: b.riderFee ?? current.riderFee,
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
              discount_percent = ${v.discountPercent}, delivery_charge = ${v.deliveryCharge}, rider_fee = ${v.riderFee},
              subtotal = ${t.subtotal}, discount = ${t.discount}, total = ${t.total}, cod_amount = ${t.codAmount},
              collect_at_door = ${t.collectAtDoor}, amount_due = ${t.amountDue},
              notes = ${"notes" in b ? (b.notes ?? null) : current.notes}, updated_at = now()
            where id = ${id}`,
      );
      if (b.items) await writeItems(tx, id, items);
      return loadOrder(tx, storeId, id);
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
      await tx.execute(sql`update orders set status = ${status}, updated_at = now() where id = ${id}`);
      // Confirming is the one moment stock moves. A zero-stock sale still goes through; the
      // warning tells the owner which products are now below zero.
      const stockWarnings: StockWarning[] = status === "confirmed" ? await deductForOrder(tx, storeId, id) : [];
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
