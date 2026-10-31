import { sql } from "drizzle-orm";
import { Router } from "express";
import { asOwner, type Db, type Tx } from "../db/client";
import { pgCode, rows } from "../db/query";
import { HttpError } from "../http-error";
import { normalisePhone } from "../phone";
import { idParam, storeIdOf } from "./ids";
import { loadOrder, type Order } from "./orders";
import { withPictures } from "./stores";

type Invoice = { id: string; orderId: string; storeId: string; status: "draft" | "final"; number: string | null; finalisedAt: Date | null; createdAt: Date };
const invoiceCols = sql`id, order_id, store_id, status, number, finalised_at, created_at`;

// The order fields an invoice shows. A change to any of these after the invoice is final is logged.
const watched = ["customerName", "customerPhone", "address", "deliveryKind", "payment", "paymentMethod", "discountPercent", "deliveryCharge", "riderFee", "deliveryPaidBy", "notes", "total", "items"] as const;

/**
 * Called by the order editor. While the order is still being prepared its invoice simply follows it; once the order is
 * out for delivery (or later), the customer may hold the invoice, so every change is written down.
 */
export async function recordInvoiceEdit(tx: Tx, before: Order, after: Order): Promise<void> {
  if (before.status !== "out_for_delivery" && before.status !== "delivered") return;
  const changed = watched.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.length === 0) return;
  const pick = (o: Order) => Object.fromEntries(watched.map((k) => [k, o[k]]));
  await tx.execute(
    sql`insert into invoice_edits (invoice_id, changed, before, after)
        select i.id, ${sql.raw(`array[${changed.map((c) => `'${c}'`).join(",")}]::text[]`)}, ${JSON.stringify(pick(before))}::jsonb, ${JSON.stringify(pick(after))}::jsonb
          from invoices i where i.order_id = ${after.id} and i.status = 'final'`,
  );
}

/** Gives a draft invoice its number: the store's next one, inside the caller's transaction (so a failed order burns none). */
async function numberDraft(tx: Tx, storeId: string, orderId: string): Promise<void> {
  const [draft] = await rows<{ id: string }>(tx, sql`select id from invoices where order_id = ${orderId} and status = 'draft'`);
  if (!draft) return;
  const [{ number }] = (await rows<{ number: string }>(tx, sql`select allocate_invoice_number(${storeId}) as number`)) as [{ number: string }];
  await tx.execute(sql`update invoices set status = 'final', number = ${number}, finalised_at = now() where id = ${draft.id} and status = 'draft'`);
}

/** An order and its invoice are made together: numbered at once, one invoice per order, never a second number. */
export async function createInvoice(tx: Tx, storeId: string, orderId: string): Promise<void> {
  await tx.execute(sql`insert into invoices (store_id, order_id) values (${storeId}, ${orderId}) on conflict (order_id) do nothing`);
  await numberDraft(tx, storeId, orderId);
}

/** Orders made before invoices were automatic get theirs (or their number) the first time the invoice is opened. */
async function ensureInvoice(tx: Tx, storeId: string, orderId: string): Promise<void> {
  const order = await loadOrder(tx, storeId, orderId);
  if (!order) return;
  const [existing] = await rows<{ status: string }>(tx, sql`select status from invoices where order_id = ${orderId}`);
  if (!existing) {
    if (order.status !== "cancelled") await createInvoice(tx, storeId, orderId);
  } else if (existing.status === "draft") {
    await numberDraft(tx, storeId, orderId);
  }
}

async function loadInvoice(tx: Tx, storeId: string, orderId: string) {
  const [invoice] = await rows<Invoice>(tx, sql`select ${invoiceCols} from invoices where order_id = ${orderId} and store_id = ${storeId}`);
  if (!invoice) return undefined;
  const order = await loadOrder(tx, storeId, orderId);
  const [store] = await rows(tx, sql`select id, name, phone, email, address, logo_version as "logoVersion", watermark_version as "watermarkVersion", watermark_on as "watermarkOn", accent from stores where id = ${storeId}`);
  const edits = await rows(tx, sql`select id, changed, before, after, created_at from invoice_edits where invoice_id = ${invoice.id} order by created_at`);
  return { invoice, order, store: store && withPictures(store as never), edits };
}

// Mounted at /v1/stores/:storeId/orders/:orderId/invoice
export function orderInvoiceRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  // Opening an order's invoice is all it takes: it already exists, with its number.
  router.get("/", async (req, res) => {
    const storeId = storeIdOf(req);
    const orderId = idParam(req, "orderId", "Order");
    const found = await asOwner(db, req.user!.id, async (tx) => {
      await ensureInvoice(tx, storeId, orderId);
      return loadInvoice(tx, storeId, orderId);
    });
    if (!found) throw new HttpError(404, "This order has no invoice.");
    res.json(found);
  });

  return router;
}

// Mounted at /v1/stores/:storeId/invoices — the searchable list.
export function invoicesRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const digits = normalisePhone(q);
    try {
      const list = await asOwner(db, req.user!.id, (tx) =>
        rows(
          tx,
          sql`select i.id, i.order_id, i.status, i.number, i.finalised_at, i.created_at,
                     o.order_no, o.customer_name, o.customer_phone, o.total, o.payment, o.status as order_status
                from invoices i join orders o on o.id = i.order_id
               where i.store_id = ${storeIdOf(req)}
                 and (${q} = '' or i.number ilike ${"%" + q + "%"} or o.customer_name ilike ${"%" + q + "%"}
                      or (${digits} <> '' and o.customer_phone like ${"%" + digits + "%"}))
               order by i.created_at desc limit 100`,
        ),
      );
      res.json({ invoices: list });
    } catch (err) {
      if (pgCode(err)) throw new HttpError(404, "Store not found.");
      throw err;
    }
  });

  return router;
}
