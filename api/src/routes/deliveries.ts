import { sql } from "drizzle-orm";
import { Router, type Request } from "express";
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
    riderScreenshotUrl: link.nullable(),
    pickupAddress: z.string().trim().max(300).nullable(),
    notes: z.string().trim().max(300).nullable(),
  })
  .partial()
  .strict();

const statusBody = z.object({ status: z.enum(["pending", "booked", "picked_up", "delivered"]) }).strict();
const order = ["pending", "booked", "picked_up", "delivered"] as const;

export type Delivery = {
  id: string;
  orderId: string;
  service: string | null;
  riderName: string | null;
  riderPhone: string | null;
  bikeNumber: string | null;
  riderPhotoUrl: string | null;
  riderScreenshotUrl: string | null;
  pickupAddress: string | null;
  notes: string | null;
  status: (typeof order)[number];
  cashHandedOver: boolean;
  cashHandedAt: Date | null;
};

const cols = sql`id, order_id, service, rider_name, rider_phone, bike_number, rider_photo_url, rider_screenshot_url, pickup_address, notes, status, cash_handed_over, cash_handed_at`;

const maps = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
const pkr = (n: number) => `PKR ${n.toLocaleString("en-US")}`;

/** The text the owner pastes into inDrive or Yango (or sends to the rider). */
export function copyText(o: Order, store: { name: string; address: string | null; phone: string | null }, notes: string | null): string {
  const lines = [
    `${store.name} · Order #${o.orderNo}`,
    store.address ? `Pickup: ${store.address}\n${maps(store.address)}` : null,
    `Deliver to: ${o.customerName}${o.customerPhone ? ` · ${o.customerPhone}` : ""}`,
    o.address ? `Address: ${o.address}\n${maps(o.address)}` : null,
    `Parcel: ${o.items.map((i) => `${i.quantity} x ${i.name}`).join(", ")}`,
    o.collectAtDoor > 0
      ? `Customer pays the rider: ${pkr(o.collectAtDoor)}${o.codAmount > 0 ? ` (goods ${pkr(o.codAmount)} for the store + rider fee ${pkr(o.riderFee)})` : ` (rider fee only; goods already paid)`}`
      : "Nothing to collect from the customer.",
    notes ?? o.notes ? `Note: ${notes ?? o.notes}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

async function loadDelivery(tx: Tx, orderId: string) {
  const [delivery] = await rows<Delivery>(tx, sql`select ${cols} from deliveries where order_id = ${orderId}`);
  const events = delivery ? await rows(tx, sql`select status, created_at from delivery_events where delivery_id = ${delivery.id} order by created_at, id`) : [];
  return { delivery: delivery ?? null, events };
}

// Mounted at /v1/stores/:storeId/orders/:orderId/delivery
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
    const result = await withOrder(req, async (tx, o, storeId, orderId) => {
      const [store] = await rows<{ name: string; address: string | null; phone: string | null }>(tx, sql`select name, address, phone from stores where id = ${storeId}`);
      const found = await loadDelivery(tx, orderId);
      return { ...found, copyText: copyText(o, store!, found.delivery?.notes ?? null) };
    });
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

  router.post("/status", validateBody(statusBody), async (req, res) => {
    const { status } = req.body as z.infer<typeof statusBody>;
    const result = await withOrder(req, async (tx, _o, _storeId, orderId) => {
      const { delivery } = await loadDelivery(tx, orderId);
      if (!delivery) throw new HttpError(404, "Save the rider details first.");
      if (order.indexOf(status) <= order.indexOf(delivery.status)) throw new HttpError(409, `The delivery is already ${delivery.status.replace(/_/g, " ")}.`);
      await tx.execute(sql`update deliveries set status = ${status}, updated_at = now() where id = ${delivery.id}`);
      await tx.execute(sql`insert into delivery_events (delivery_id, status) values (${delivery.id}, ${status})`);
      return loadDelivery(tx, orderId);
    });
    res.json(result);
  });

  return router;
}
