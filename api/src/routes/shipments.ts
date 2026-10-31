import { sql } from "drizzle-orm";
import express, { Router, type Request } from "express";
import { z } from "zod";
import { asOwner, type Db, type Tx } from "../db/client";
import { pgCode, rows } from "../db/query";
import { HttpError } from "../http-error";
import { validateBody } from "../validate";
import { idParam, storeIdOf } from "./ids";
import { loadOrder } from "./orders";

const putBody = z
  .object({
    courier: z.string().trim().min(1).max(40),
    trackingNo: z.string().trim().min(1).max(60).nullable(),
    trackingUrl: z.string().trim().url().regex(/^https:\/\//, "use a https:// link").nullable(),
    shippedOn: z.iso.date().nullable(),
  })
  .partial()
  .strict();
// A parcel is only who carries it and how to follow it. It has no status of its own: the order's progress is the
// order's status (orders.ts), moved by the main button and nothing else.
type Shipment = { id: string; orderId: string; courier: string; trackingNo: string | null; trackingUrl: string | null; shippedOn: string | null; hasPhoto: boolean };
const cols = sql`id, order_id, courier, tracking_no, tracking_url, to_char(shipped_on, 'YYYY-MM-DD') as shipped_on, exists (select 1 from shipment_photos p where p.shipment_id = shipments.id) as has_photo`;

async function load(tx: Tx, orderId: string) {
  const [shipment] = await rows<Shipment>(tx, sql`select ${cols} from shipments where order_id = ${orderId}`);
  return { shipment: shipment ?? null };
}

// Mounted at /v1/stores/:storeId/orders/:orderId/shipment
export function shipmentRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  const inOrder = <T>(req: Request, fn: (tx: Tx, orderId: string) => Promise<T>) => {
    const storeId = storeIdOf(req);
    const orderId = idParam(req, "orderId", "Order");
    return asOwner(db, req.user!.id, async (tx) => {
      const order = await loadOrder(tx, storeId, orderId);
      if (!order) throw new HttpError(404, "Order not found.");
      if (order.deliveryKind !== "courier") throw new HttpError(409, "Only a courier order has a shipment.");
      return fn(tx, orderId);
    });
  };

  router.get("/", async (req, res) => res.json(await inOrder(req, (tx, id) => load(tx, id))));

  // First save creates the record (a courier name is needed); later saves change only what is sent.
  router.put("/", validateBody(putBody), async (req, res) => {
    const b = req.body as z.infer<typeof putBody>;
    const storeId = storeIdOf(req);
    try {
      const result = await inOrder(req, async (tx, orderId) => {
        const { shipment } = await load(tx, orderId);
        if (!shipment) {
          if (!b.courier) throw new HttpError(400, "Name the courier first.");
          await tx.execute(
            sql`insert into shipments (store_id, order_id, courier, tracking_no, tracking_url, shipped_on)
                values (${storeId}, ${orderId}, ${b.courier}, ${b.trackingNo ?? null}, ${b.trackingUrl ?? null}, coalesce(${b.shippedOn ?? null}::date, current_date))
                on conflict (order_id) do nothing`,
          );
        } else {
          const has = (k: keyof typeof b) => k in b;
          await tx.execute(
            sql`update shipments set
                  courier = coalesce(${b.courier ?? null}, courier),
                  tracking_no = case when ${has("trackingNo")} then ${b.trackingNo ?? null} else tracking_no end,
                  tracking_url = case when ${has("trackingUrl")} then ${b.trackingUrl ?? null} else tracking_url end,
                  shipped_on = case when ${has("shippedOn")} then ${b.shippedOn ?? null}::date else shipped_on end,
                  updated_at = now()
                where id = ${shipment.id}`,
          );
        }
        return load(tx, orderId);
      });
      res.json(result);
    } catch (err) {
      if (pgCode(err) === "23505") throw new HttpError(409, "Another parcel already has that tracking number.");
      throw err;
    }
  });

  // The parcel's photo: one small JPEG or WebP per shipment (the app shrinks it first), like the rider's photo. It needs
  // a saved courier, lives in the database, goes with the parcel, and reaches the customer only through a valid card link.
  const photoBody = express.raw({ type: ["image/jpeg", "image/webp"], limit: "600kb" });
  router.put("/photo", photoBody, async (req, res) => {
    const type = req.headers["content-type"]?.split(";")[0];
    const bytes = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new HttpError(400, "Send the photo as a JPEG or WebP image, up to 600 KB.");
    const result = await inOrder(req, async (tx, orderId) => {
      const { shipment } = await load(tx, orderId);
      if (!shipment) throw new HttpError(409, "Add the courier first, then the photo.");
      await tx.execute(
        sql`insert into shipment_photos (shipment_id, image, content_type) values (${shipment.id}, ${bytes}, ${type})
            on conflict (shipment_id) do update set image = excluded.image, content_type = excluded.content_type, created_at = now()`,
      );
      return { hasPhoto: true };
    });
    res.json(result);
  });

  router.delete("/photo", async (req, res) => {
    const result = await inOrder(req, async (tx, orderId) => {
      const gone = await rows<{ id: string }>(tx, sql`delete from shipment_photos where shipment_id = (select id from shipments where order_id = ${orderId}) returning shipment_id as id`);
      return { removed: gone.length };
    });
    res.json(result);
  });

  return router;
}

// Mounted at /v1/stores/:storeId/shipments — the store's parcels, newest first, each with its order's stage.
export function shipmentsListRouter(db: Db): Router {
  const router = Router({ mergeParams: true });
  router.get("/", async (req, res) => {
    const list = await asOwner(db, req.user!.id, (tx) =>
      rows(
        tx,
        sql`select s.id, s.order_id, s.courier, s.tracking_no, s.tracking_url, to_char(s.shipped_on, 'YYYY-MM-DD') as shipped_on,
                   o.order_no, o.customer_name, o.cod_amount, o.status as order_status
              from shipments s join orders o on o.id = s.order_id
             where s.store_id = ${storeIdOf(req)}
             order by s.created_at desc limit 200`,
      ),
    );
    res.json({ shipments: list });
  });
  return router;
}
