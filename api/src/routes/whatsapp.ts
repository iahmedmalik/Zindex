import { sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { asOwner, type Db } from "../db/client";
import { rows } from "../db/query";
import { HttpError } from "../http-error";
import { defaults, fill, templateKeys, waLink, type TemplateKey } from "../whatsapp/templates";
import { validateBody } from "../validate";
import { idParam, storeIdOf } from "./ids";
import { loadOrder } from "./orders";

const putBody = z.object({ body: z.string().trim().min(1).max(1000) }).strict();

const keyOf = (value: unknown): TemplateKey => {
  if (!(templateKeys as readonly string[]).includes(String(value))) throw new HttpError(404, "Unknown template.");
  return value as TemplateKey;
};

// Mounted at /v1/stores/:storeId
export function whatsappRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  // Every template with the store's own wording if it has edited it, else the default.
  router.get("/templates", async (req, res) => {
    const custom = await asOwner(db, req.user!.id, (tx) => rows<{ key: TemplateKey; body: string }>(tx, sql`select key, body from message_templates where store_id = ${storeIdOf(req)}`));
    const mine = new Map(custom.map((c) => [c.key, c.body]));
    res.json({ templates: templateKeys.map((key) => ({ key, body: mine.get(key) ?? defaults[key], edited: mine.has(key) })) });
  });

  router.put("/templates/:key", validateBody(putBody), async (req, res) => {
    const key = keyOf(req.params.key);
    const { body } = req.body as z.infer<typeof putBody>;
    await asOwner(db, req.user!.id, async (tx) => {
      const [store] = await rows<{ id: string }>(tx, sql`select id from stores where id = ${storeIdOf(req)}`);
      if (!store) throw new HttpError(404, "Store not found.");
      await tx.execute(
        sql`insert into message_templates (store_id, key, body) values (${store.id}, ${key}, ${body})
            on conflict (store_id, key) do update set body = excluded.body, updated_at = now()`,
      );
    });
    res.json({ template: { key, body, edited: true } });
  });

  // Back to the default wording.
  router.delete("/templates/:key", async (req, res) => {
    const key = keyOf(req.params.key);
    await asOwner(db, req.user!.id, (tx) => tx.execute(sql`delete from message_templates where store_id = ${storeIdOf(req)} and key = ${key}`));
    res.json({ template: { key, body: defaults[key], edited: false } });
  });

  // The ready-to-send message for one order: text to copy, and a wa.me link that opens the chat.
  // `link` is the delivery card link, passed by the app right after it creates one (the API keeps only a hash).
  router.get("/orders/:orderId/whatsapp", async (req, res) => {
    const key = keyOf(req.query.template);
    const link = typeof req.query.link === "string" ? req.query.link.slice(0, 300) : "";
    const storeId = storeIdOf(req);
    const orderId = idParam(req, "orderId", "Order");
    const message = await asOwner(db, req.user!.id, async (tx) => {
      const order = await loadOrder(tx, storeId, orderId);
      if (!order) throw new HttpError(404, "Order not found.");
      const [mine] = await rows<{ body: string }>(tx, sql`select body from message_templates where store_id = ${storeId} and key = ${key}`);
      const [store] = await rows<{ name: string }>(tx, sql`select name from stores where id = ${storeId}`);
      const [delivery] = await rows<{ riderName: string | null; riderPhone: string | null; bikeNumber: string | null }>(tx, sql`select rider_name, rider_phone, bike_number from deliveries where order_id = ${orderId}`);
      const [invoice] = await rows<{ number: string | null }>(tx, sql`select number from invoices where order_id = ${orderId}`);
      const text = fill(mine?.body ?? defaults[key], {
        name: order.customerName,
        order_no: order.orderNo,
        store: store?.name,
        total: order.total.toLocaleString("en-US"),
        collect: order.collectAtDoor.toLocaleString("en-US"),
        amount_due: order.amountDue.toLocaleString("en-US"),
        invoice_no: invoice?.number ?? "",
        rider_name: delivery?.riderName,
        rider_phone: delivery?.riderPhone,
        bike: delivery?.bikeNumber,
        link,
      });
      return { text, waLink: waLink(order.customerPhone, text) };
    });
    res.json(message);
  });

  return router;
}
