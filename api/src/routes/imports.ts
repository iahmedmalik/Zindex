import express, { Router } from "express";
import { sql } from "drizzle-orm";
import { asOwner, type Db } from "../db/client";
import { rows } from "../db/query";
import { HttpError } from "../http-error";
import { parseCsv } from "../import/csv-parse";
import { mapShopifyOrders } from "../import/shopify-orders";
import { storeIdOf } from "./ids";
import { insertOrder } from "./orders";

const MAX_ORDERS = 2000;

// Mounted at /v1/stores/:storeId/import
export function importsRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  // Body: the Shopify orders CSV as text (Content-Type: text/csv), at most 2 MB.
  // Every new order is invoiced and numbered as it is made (insertOrder); orders already imported are skipped, so the same file
  // can be imported again safely. Products are matched to the catalogue by name.
  router.post("/shopify-orders", express.text({ type: ["text/csv", "text/plain"], limit: "2mb" }), async (req, res) => {
    if (typeof req.body !== "string" || req.body.trim() === "") throw new HttpError(400, "Send the Shopify orders CSV file.");
    let parsed: Record<string, string>[];
    try {
      parsed = parseCsv(req.body);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : "The file could not be read.");
    }
    if (parsed.length > 0 && !Object.keys(parsed[0]!).some((k) => k.toLowerCase() === "name")) throw new HttpError(400, "This does not look like a Shopify orders export (no Name column).");
    const { orders, skipped, warnings } = mapShopifyOrders(parsed);
    if (orders.length > MAX_ORDERS) throw new HttpError(400, `Import at most ${MAX_ORDERS} orders at a time.`);
    const storeId = storeIdOf(req);

    const result = await asOwner(db, req.user!.id, async (tx) => {
      const [store] = await rows<{ id: string }>(tx, sql`select id from stores where id = ${storeId}`);
      if (!store) throw new HttpError(404, "Store not found.");
      const catalogue = new Map((await rows<{ id: string; name: string }>(tx, sql`select id, name from products where store_id = ${storeId}`)).map((p) => [p.name.toLowerCase(), p.id]));
      const done = new Set((await rows<{ externalRef: string }>(tx, sql`select external_ref from orders where store_id = ${storeId} and external_ref is not null`)).map((r) => r.externalRef));
      const imported: { ref: string; orderNo: number }[] = [];
      const already: string[] = [];
      for (const o of orders) {
        if (done.has(o.externalRef)) { already.push(o.externalRef); continue; }
        const id = await insertOrder(tx, storeId, {
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          address: o.address,
          items: o.items.map((i) => {
            const productId = catalogue.get(i.name.toLowerCase());
            return productId ? { productId, quantity: i.quantity, unitPrice: i.unitPrice } : i;
          }),
          discountPercent: o.discountPercent,
          deliveryCharge: o.deliveryCharge,
          deliveryKind: "courier",
          payment: o.payment,
          paymentMethod: o.paymentMethod,
          notes: o.notes,
          source: "shopify",
          externalRef: o.externalRef,
        });
        const [{ orderNo }] = (await rows<{ orderNo: number }>(tx, sql`select order_no from orders where id = ${id}`)) as [{ orderNo: number }];
        imported.push({ ref: o.externalRef, orderNo });
      }
      return { imported, alreadyImported: already, skipped, warnings };
    });
    res.json(result);
  });

  return router;
}
