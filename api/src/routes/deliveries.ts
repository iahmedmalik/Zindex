import { sql } from "drizzle-orm";
import express, { Router, type Request } from "express";
import { z } from "zod";
import { asOwner, type Db, type Tx } from "../db/client";
import { rows } from "../db/query";
import { HttpError } from "../http-error";
import { normalisePhone } from "../phone";
import { validateBody } from "../validate";
import { idParam, storeIdOf } from "./ids";
import { loadOrder, type Order } from "./orders";

const link = z.string().trim().url().regex(/^https:\/\//, "use a https:// link");

const putBody = z
  .object({
    service: z.enum(["indrive", "yango"]).nullable(),
    riderName: z.string().trim().min(1).max(80).nullable(),
    riderPhone: z
      .string()
      .trim()
      .transform(normalisePhone)
      .refine((p) => /^[0-9]{7,15}$/.test(p), "enter a phone number with 7 to 15 digits")
      .nullable(),
    bikeNumber: z.string().trim().min(1).max(20).nullable(),
    riderPhotoUrl: link.nullable(),
    riderPhotoTakenAt: z.string().datetime().nullable(),
    trackingUrl: link.nullable(),
    riderScreenshotUrl: link.nullable(),
    pickupAddress: z.string().trim().max(300).nullable(),
    notes: z.string().trim().max(300).nullable(),
  })
  .partial()
  .strict();

export type Delivery = {
  id: string;
  orderId: string;
  service: string | null;
  riderName: string | null;
  riderPhone: string | null;
  bikeNumber: string | null;
  riderPhotoUrl: string | null;
  hasPhoto: boolean;
  riderPhotoTakenAt: Date | null;
  trackingUrl: string | null;
  riderScreenshotUrl: string | null;
  pickupAddress: string | null;
  notes: string | null;
};

const cols = sql`id, order_id, service, rider_name, rider_phone, bike_number, rider_photo_url, rider_photo_taken_at, tracking_url, rider_screenshot_url, pickup_address, notes, exists (select 1 from delivery_photos p where p.delivery_id = deliveries.id) as has_photo`;

async function loadDelivery(tx: Tx, orderId: string) {
  const [delivery] = await rows<Delivery>(tx, sql`select ${cols} from deliveries where order_id = ${orderId}`);
  return { delivery: delivery ?? null };
}

// Mounted at /v1/stores/:storeId/orders/:orderId/delivery. The rider is optional details for the owner and the card;
// the order's own status (orders.ts) is the only status, so nothing here moves an order along.
export function deliveriesRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  const withOrder = async <T>(req: Request, fn: (tx: Tx, o: Order, storeId: string, orderId: string) => Promise<T>) => {
    const storeId = storeIdOf(req);
    const orderId = idParam(req, "orderId", "Order");
    return asOwner(db, req.user!.id, async (tx) => {
      const o = await loadOrder(tx, storeId, orderId);
      if (!o) throw new HttpError(404, "Order not found.");
      return fn(tx, o, storeId, orderId);
    });
  };

  router.get("/", async (req, res) => {
    const result = await withOrder(req, (tx, _o, _storeId, orderId) => loadDelivery(tx, orderId));
    res.json(result);
  });

  // Creates the delivery on first save, then updates only the fields sent.
  router.put("/", validateBody(putBody), async (req, res) => {
    const b = req.body as z.infer<typeof putBody>;
    const result = await withOrder(req, async (tx, o, storeId, orderId) => {
      if (o.deliveryKind !== "local") throw new HttpError(409, "Only a local-delivery order has a rider delivery.");
      if (o.status === "cancelled") throw new HttpError(409, "A cancelled order has no delivery.");
      await tx.execute(sql`insert into deliveries (store_id, order_id) values (${storeId}, ${orderId}) on conflict (order_id) do nothing`);
      const has = (k: keyof typeof b) => k in b;
      await tx.execute(
        sql`update deliveries set
              service = case when ${has("service")} then ${b.service ?? null} else service end,
              rider_name = case when ${has("riderName")} then ${b.riderName ?? null} else rider_name end,
              rider_phone = case when ${has("riderPhone")} then ${b.riderPhone ?? null} else rider_phone end,
              bike_number = case when ${has("bikeNumber")} then ${b.bikeNumber ?? null} else bike_number end,
              rider_photo_url = case when ${has("riderPhotoUrl")} then ${b.riderPhotoUrl ?? null} else rider_photo_url end,
              rider_photo_taken_at = case when ${has("riderPhotoTakenAt")} then ${b.riderPhotoTakenAt ?? null}::timestamptz else rider_photo_taken_at end,
              tracking_url = case when ${has("trackingUrl")} then ${b.trackingUrl ?? null} else tracking_url end,
              rider_screenshot_url = case when ${has("riderScreenshotUrl")} then ${b.riderScreenshotUrl ?? null} else rider_screenshot_url end,
              pickup_address = case when ${has("pickupAddress")} then ${b.pickupAddress ?? null} else pickup_address end,
              notes = case when ${has("notes")} then ${b.notes ?? null} else notes end,
              updated_at = now()
            where order_id = ${orderId}`,
      );
      return loadDelivery(tx, orderId);
    });
    res.json(result);
  });

  // The rider's photo: one small JPEG or WebP per delivery (the app shrinks it first). It lives in the
  // database, goes with the delivery, and reaches the customer only through a valid card link.
  const photoBody = express.raw({ type: ["image/jpeg", "image/webp"], limit: "600kb" });
  router.put("/photo", photoBody, async (req, res) => {
    const type = req.headers["content-type"]?.split(";")[0];
    const bytes = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new HttpError(400, "Send the photo as a JPEG or WebP image, up to 600 KB.");
    const result = await withOrder(req, async (tx, o, storeId, orderId) => {
      if (o.deliveryKind !== "local") throw new HttpError(409, "Only a local-delivery order has a rider photo.");
      if (o.status === "cancelled") throw new HttpError(409, "A cancelled order has no delivery.");
      await tx.execute(sql`insert into deliveries (store_id, order_id) values (${storeId}, ${orderId}) on conflict (order_id) do nothing`);
      const { delivery } = await loadDelivery(tx, orderId);
      await tx.execute(
        sql`insert into delivery_photos (delivery_id, image, content_type) values (${delivery!.id}, ${bytes}, ${type})
            on conflict (delivery_id) do update set image = excluded.image, content_type = excluded.content_type, created_at = now()`,
      );
      return { hasPhoto: true };
    });
    res.json(result);
  });

  router.delete("/photo", async (req, res) => {
    const result = await withOrder(req, async (tx, _o, _storeId, orderId) => {
      const gone = await rows<{ id: string }>(tx, sql`delete from delivery_photos where delivery_id = (select id from deliveries where order_id = ${orderId}) returning delivery_id as id`);
      return { removed: gone.length };
    });
    res.json(result);
  });

  return router;
}
