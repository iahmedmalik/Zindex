import { sql } from "drizzle-orm";
import { Router } from "express";
import { asOwner, type Db, type Tx } from "../db/client";
import { pgCode, rows } from "../db/query";
import { HttpError } from "../http-error";
import { normalisePhone } from "../phone";
import { idParam, storeIdOf } from "./ids";
import { loadOrder, type Order } from "./orders";

type Invoice = { id: string; orderId: string; storeId: string; status: "draft" | "final"; number: string | null; finalisedAt: Date | null; createdAt: Date };
const invoiceCols = sql`id, order_id, store_id, status, number, finalised_at, created_at`;

// The order fields an invoice shows. A change to any of these after the invoice is final is logged.
const watched = ["customerName", "customerPhone", "address", "deliveryKind", "payment", "paymentMethod", "discountPercent", "deliveryCharge", "riderFee", "notes", "total", "items"] as const;

/** Called by the order editor: if the order's invoice is final, write down what changed. */
export async function recordInvoiceEdit(tx: Tx, before: Order, after: Order): Promise<void> {
  const changed = watched.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.length === 0) return;
  const pick = (o: Order) => Object.fromEntries(watched.map((k) => [k, o[k]]));
  await tx.execute(
    sql`insert into invoice_edits (invoice_id, changed, before, after)
        select i.id, ${sql.raw(`array[${changed.map((c) => `'${c}'`).join(",")}]::text[]`)}, ${JSON.stringify(pick(before))}::jsonb, ${JSON.stringify(pick(after))}::jsonb
          from invoices i where i.order_id = ${after.id} and i.status = 'final'`,
  );
}

async function loadInvoice(tx: Tx, storeId: string, orderId: string) {
  const [invoice] = await rows<Invoice>(tx, sql`select ${invoiceCols} from invoices where order_id = ${orderId} and store_id = ${storeId}`);
  if (!invoice) return undefined;
  const order = await loadOrder(tx, storeId, orderId);
  const [store] = await rows(tx, sql`select name, phone, address, logo_url, accent from stores where id = ${storeId}`);
  const edits = await rows(tx, sql`select id, changed, before, after, created_at from invoice_edits where invoice_id = ${invoice.id} order by created_at`);
  return { invoice, order, store, edits };
}

// Mounted at /v1/stores/:storeId/orders/:orderId/invoice
export function orderInvoiceRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const found = await asOwner(db, req.user!.id, (tx) => loadInvoice(tx, storeIdOf(req), idParam(req, "orderId", "Order")));
    if (!found) throw new HttpError(404, "This order has no invoice yet.");
    res.json(found);
  });

  // Makes the draft. Asking again returns the same invoice: one order never gets two.
  router.post("/", async (req, res) => {
    const storeId = storeIdOf(req);
    const orderId = idParam(req, "orderId", "Order");
    const result = await asOwner(db, req.user!.id, async (tx) => {
      const order = await loadOrder(tx, storeId, orderId);
      if (!order) throw new HttpError(404, "Order not found.");
      if (order.status === "cancelled") throw new HttpError(409, "A cancelled order cannot be invoiced.");
      const existing = await loadInvoice(tx, storeId, orderId);
      if (existing) return { ...existing, created: false };
      await tx.execute(sql`insert into invoices (store_id, order_id) values (${storeId}, ${orderId}) on conflict (order_id) do nothing`);
      return { ...(await loadInvoice(tx, storeId, orderId))!, created: true };
    });
    const { created, ...body } = result;
    res.status(created ? 201 : 200).json(body);
  });

  // Finalising gives the invoice its number. Doing it twice changes nothing.
  router.post("/finalise", async (req, res) => {
    const storeId = storeIdOf(req);
    const orderId = idParam(req, "orderId", "Order");
    const found = await asOwner(db, req.user!.id, async (tx) => {
      const current = await loadInvoice(tx, storeId, orderId);
      if (!current) throw new HttpError(404, "Create the invoice draft first.");
      if (current.invoice.status === "final") return current;
      if (current.order!.status === "cancelled") throw new HttpError(409, "A cancelled order cannot be invoiced.");
      const [{ number }] = (await rows<{ number: string }>(tx, sql`select allocate_invoice_number(${storeId}) as number`)) as [{ number: string }];
      await tx.execute(sql`update invoices set status = 'final', number = ${number}, finalised_at = now() where id = ${current.invoice.id} and status = 'draft'`);
      return loadInvoice(tx, storeId, orderId);
    });
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
