import { sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import { asOwner, type Db, type Tx } from "../db/client";
import { pgCode, rows } from "../db/query";
import { HttpError } from "../http-error";
import { validateBody } from "../validate";
import { idParam, storeIdOf } from "./ids";
import { loadOrder } from "./orders";

const statuses = ["shipped", "delivered", "delayed", "returned", "failed"] as const;

const putBody = z
  .object({
    courier: z.string().trim().min(1).max(40),
    trackingNo: z.string().trim().min(1).max(60).nullable(),
    trackingUrl: z.string().trim().url().regex(/^https:\/\//, "use a https:// link").nullable(),
    shippedOn: z.iso.date().nullable(),
  })
  .partial()
  .strict();
const statusBody = z
  .object({ status: z.enum(statuses), failureReason: z.string().trim().min(1).max(200).optional() })
  .strict()
  .refine((b) => (b.status === "failed" || b.status === "returned" ? true : b.failureReason === undefined), "a reason is only for a failed or returned parcel");

type Shipment = { id: string; orderId: string; courier: string; trackingNo: string | null; trackingUrl: string | null; shippedOn: string | null; status: (typeof statuses)[number]; failureReason: string | null };
const cols = sql`id, order_id, courier, tracking_no, tracking_url, to_char(shipped_on, 'YYYY-MM-DD') as shipped_on, status, failure_reason`;

async function load(tx: Tx, orderId: string) {
  const [shipment] = await rows<Shipment>(tx, sql`select ${cols} from shipments where order_id = ${orderId}`);
  const events = shipment ? await rows(tx, sql`select status, note, created_at from shipment_events where shipment_id = ${shipment.id} order by created_at, id`) : [];
  return { shipment: shipment ?? null, events };
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
          const [{ id }] = (await rows<{ id: string }>(tx, sql`select id from shipments where order_id = ${orderId}`)) as [{ id: string }];
          await tx.execute(sql`insert into shipment_events (shipment_id, status) values (${id}, 'shipped')`);
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

  router.post("/status", validateBody(statusBody), async (req, res) => {
    const b = req.body as z.infer<typeof statusBody>;
    const result = await inOrder(req, async (tx, orderId) => {
      const { shipment } = await load(tx, orderId);
      if (!shipment) throw new HttpError(404, "Save the shipment first.");
      if (shipment.status === b.status) throw new HttpError(409, `The parcel is already ${b.status}.`);
      await tx.execute(sql`update shipments set status = ${b.status}, failure_reason = ${b.failureReason ?? null}, updated_at = now() where id = ${shipment.id}`);
      await tx.execute(sql`insert into shipment_events (shipment_id, status, note) values (${shipment.id}, ${b.status}, ${b.failureReason ?? null})`);
      return load(tx, orderId);
    });
    res.json(result);
  });

  return router;
}

// Mounted at /v1/stores/:storeId/shipments — the store's parcels, newest first, optionally by status.
export function shipmentsListRouter(db: Db): Router {
  const router = Router({ mergeParams: true });
  router.get("/", async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    if (status && !(statuses as readonly string[]).includes(status)) throw new HttpError(400, "Unknown status.");
    const list = await asOwner(db, req.user!.id, (tx) =>
      rows(
        tx,
        sql`select s.id, s.order_id, s.courier, s.tracking_no, s.tracking_url, to_char(s.shipped_on, 'YYYY-MM-DD') as shipped_on, s.status, s.failure_reason,
                   o.order_no, o.customer_name, o.cod_amount
              from shipments s join orders o on o.id = s.order_id
             where s.store_id = ${storeIdOf(req)} and (${status} = '' or s.status = ${status})
             order by s.created_at desc limit 200`,
      ),
    );
    res.json({ shipments: list });
  });
  return router;
}
