import { sql } from "drizzle-orm";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { Config } from "../config";
import { asOwner, type Db } from "../db/client";
import { rows } from "../db/query";
import { hashOf, liveCard, makeCard } from "../cards/token";
import { HttpError } from "../http-error";
import { validateBody } from "../validate";
import { idParam, storeIdOf } from "./ids";
import { loadOrder } from "./orders";

const createBody = z.object({ days: z.number().int().min(1).max(30).optional() }).strict();

// Mounted at /v1/stores/:storeId/orders/:orderId/card (owner side)
export function cardsRouter(db: Db, config: Config): Router {
  const router = Router({ mergeParams: true });

  // The order's live link, so the page can show and copy it on any visit. It is made when the order is confirmed.
  // card is null when there is none yet; url is null for an old random link that cannot be shown again.
  router.get("/", async (req, res) => {
    const card = await asOwner(db, req.user!.id, async (tx) => {
      const order = await loadOrder(tx, storeIdOf(req), idParam(req, "orderId", "Order"));
      if (!order) throw new HttpError(404, "Order not found.");
      return liveCard(tx, config.BETTER_AUTH_SECRET, config.WEB_ORIGIN, order.id);
    });
    res.json({ card });
  });

  // Makes a fresh link and switches off any earlier one for this order ("Make a new link").
  router.post("/", validateBody(createBody), async (req, res) => {
    const days = (req.body as z.infer<typeof createBody>).days ?? 7;
    const storeId = storeIdOf(req);
    const orderId = idParam(req, "orderId", "Order");
    const card = await asOwner(db, req.user!.id, async (tx) => {
      const order = await loadOrder(tx, storeId, orderId);
      if (!order) throw new HttpError(404, "Order not found.");
      if (order.status === "cancelled") throw new HttpError(409, "A cancelled order has no delivery card.");
      return makeCard(tx, config.BETTER_AUTH_SECRET, config.WEB_ORIGIN, orderId, days);
    });
    res.status(201).json(card);
  });

  router.delete("/", async (req, res) => {
    const revoked = await asOwner(db, req.user!.id, (tx) =>
      rows<{ id: string }>(
        tx,
        sql`update delivery_cards set revoked_at = now()
             where order_id = ${idParam(req, "orderId", "Order")} and revoked_at is null
               and exists (select 1 from orders o where o.id = delivery_cards.order_id and o.store_id = ${storeIdOf(req)})
         returning id`,
      ),
    );
    res.json({ revoked: revoked.length });
  });

  return router;
}

// Mounted at /v1/public/card/:token — no sign-in. Rate limited, never cached, hidden from search engines.
export function publicCardRouter(db: Db): Router {
  const router = Router();
  router.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please wait a minute." } }));

  router.get("/:token", async (req, res) => {
    const token = String(req.params.token);
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, "This link is not available.");
    const result = await db.transaction(async (tx) => rows<{ card: unknown }>(tx, sql`select get_delivery_card(${hashOf(token)}) as card`));
    const card = result[0]?.card;
    if (!card) throw new HttpError(404, "This link has expired or is no longer available.");
    res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }).json({ card });
  });

  // The rider's picture, only while the card link is valid.
  router.get("/:token/photo", async (req, res) => {
    const token = String(req.params.token);
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, "This link is not available.");
    const found = await db.transaction(async (tx) => rows<{ image: Buffer; contentType: string }>(tx, sql`select image, content_type from get_delivery_photo(${hashOf(token)})`));
    const photo = found[0];
    if (!photo) throw new HttpError(404, "There is no photo for this link.");
    res.set({ "Content-Type": photo.contentType, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" }).send(photo.image);
  });

  // The parcel's picture (courier orders), only while the card link is valid.
  router.get("/:token/shipment-photo", async (req, res) => {
    const token = String(req.params.token);
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, "This link is not available.");
    const found = await db.transaction(async (tx) => rows<{ image: Buffer; contentType: string }>(tx, sql`select image, content_type from get_shipment_photo(${hashOf(token)})`));
    const photo = found[0];
    if (!photo) throw new HttpError(404, "There is no photo for this link.");
    res.set({ "Content-Type": photo.contentType, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" }).send(photo.image);
  });

  // The store's logo and watermark, only while the card link is valid.
  router.get("/:token/store-image/:kind", async (req, res) => {
    const token = String(req.params.token);
    const kind = String(req.params.kind);
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token) || (kind !== "logo" && kind !== "watermark")) throw new HttpError(404, "This link is not available.");
    const found = await db.transaction(async (tx) => rows<{ image: Buffer; contentType: string }>(tx, sql`select image, content_type from get_card_store_image(${hashOf(token)}, ${kind})`));
    if (!found[0]) throw new HttpError(404, "There is no picture for this link.");
    res.set({ "Content-Type": found[0].contentType, "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" }).send(found[0].image);
  });

  return router;
}
