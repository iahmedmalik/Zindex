import { sql } from "drizzle-orm";
import { Router } from "express";
import { asOwner, type Db } from "../db/client";
import { rows } from "../db/query";

// A complete download of everything one owner has, as one JSON file. It runs as that owner, so
// row-level security guarantees another owner's rows can never be in it. Secrets and sign-in data
// (passwords, sessions, card link hashes) are left out on purpose.
const tables = [
  ["stores", sql`select id, name, phone, address, accent, invoice_prefix, created_at from stores order by created_at`],
  ["products", sql`select id, store_id, name, price, cost, active, shopify_product_id, image_url, created_at from products order by created_at`],
  ["customers", sql`select id, store_id, name, phone, addresses, notes, created_at from customers order by created_at`],
  ["orders", sql`select * from orders order by created_at`],
  ["orderItems", sql`select id, order_id, product_id, position, name, quantity, unit_price, discount_kind, discount_value, discount_amount from order_items order by order_id, position`],
  ["invoices", sql`select id, store_id, order_id, status, number, finalised_at, created_at from invoices order by created_at`],
  ["invoiceEdits", sql`select id, invoice_id, changed, before, after, created_at from invoice_edits order by created_at`],
  ["stockMovements", sql`select id, store_id, product_id, delta, reason, order_id, note, created_at from stock_movements order by created_at`],
  ["deliveries", sql`select * from deliveries order by created_at`],
  ["shipments", sql`select * from shipments order by created_at`],
  ["messageTemplates", sql`select id, store_id, key, body, updated_at from message_templates order by store_id, key`],
] as const;

export function backupRouter(db: Db): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const data = await asOwner(db, req.user!.id, async (tx) => {
      const out: Record<string, unknown[]> = {};
      for (const [name, query] of tables) {
        out[name] = (await rows<Record<string, unknown>>(tx, query)).map(({ ownerId: _o, ...rest }) => rest);
      }
      return out;
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res
      .set({ "Content-Disposition": `attachment; filename="zindex-backup-${stamp}.json"`, "Cache-Control": "no-store" })
      .json({ format: "zindex-backup", version: 1, exportedAt: new Date().toISOString(), owner: { id: req.user!.id, email: req.user!.email }, data });
  });

  return router;
}
