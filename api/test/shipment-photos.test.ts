import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { purgeDeliveryPhotos } from "../src/maintenance";
import { buildTestApp, connect, newId, newVerifiedOwner, urls } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

// The courier card: courier, tracking number and link, and an optional parcel photo, like the rider card.
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
const bin = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); };

async function setup(kind = "courier") {
  const owner = await newVerifiedOwner(t.app, t.mailer);
  const call = (method: "get" | "post" | "put" | "delete", path: string, body?: object) => request(t.app)[method](path).set("Cookie", owner.cookie).send(body);
  const store = (await call("post", "/v1/stores", { name: newId("Store") })).body.store.id as string;
  const order = (await call("post", `/v1/stores/${store}/orders`, { customerName: "Hira", deliveryKind: kind, deliveryCharge: 250, items: [{ name: "Oud", quantity: 1, unitPrice: 6500 }] })).body.order.id as string;
  const base = `/v1/stores/${store}/orders/${order}`;
  const token = (await call("post", `${base}/card`, {})).body.token as string;
  return {
    owner, store, order, token,
    saveCourier: (body: object) => call("put", `${base}/shipment`, body),
    putPhoto: (body: Buffer, type = "image/jpeg") => request(t.app).put(`${base}/shipment/photo`).set("Cookie", owner.cookie).set("Content-Type", type).send(body),
    delPhoto: () => call("delete", `${base}/shipment/photo`),
    card: () => request(t.app).get(`/v1/public/card/${token}`),
    pic: () => request(t.app).get(`/v1/public/card/${token}/shipment-photo`).buffer(true).parse(bin),
  };
}

describe("the courier card", () => {
  it("shows the courier, tracking number and link, and none of it before a courier is saved", async () => {
    const s = await setup();
    expect((await s.card()).body.card.shipment).toBeNull();
    await s.saveCourier({ courier: "TCS", trackingNo: "77881234", trackingUrl: "https://www.tcsexpress.com/track/77881234" });
    const card = (await s.card()).body.card;
    expect(card.shipment).toMatchObject({ courier: "TCS", trackingNo: "77881234", trackingUrl: "https://www.tcsexpress.com/track/77881234", hasPhoto: false, photoTakenAt: null });
  });

  it("carries only a courier name when that is all that was saved", async () => {
    const s = await setup();
    await s.saveCourier({ courier: "Leopards" });
    expect((await s.card()).body.card.shipment).toMatchObject({ courier: "Leopards", trackingNo: null, trackingUrl: null });
  });
});

describe("the parcel photo", () => {
  it("is uploaded, shown through the card link, replaced and removed", async () => {
    const s = await setup();
    await s.saveCourier({ courier: "TCS" });
    expect((await s.putPhoto(jpeg)).status).toBe(200);
    const saved = await request(t.app).get(`/v1/stores/${s.store}/orders/${s.order}/shipment`).set("Cookie", s.owner.cookie);
    expect(saved.body.shipment.hasPhoto).toBe(true);

    const card = (await s.card()).body.card;
    expect(card.shipment.hasPhoto).toBe(true);
    expect(card.shipment.photoTakenAt).toBeTruthy();

    const pic = await s.pic();
    expect(pic.status).toBe(200);
    expect(pic.headers["content-type"]).toBe("image/jpeg");
    expect(pic.headers["cache-control"]).toBe("no-store");
    expect(Buffer.compare(pic.body as Buffer, jpeg)).toBe(0);

    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(500, 1)]);
    expect((await s.putPhoto(webp, "image/webp")).status).toBe(200);
    expect((await s.pic()).headers["content-type"]).toBe("image/webp");

    expect((await s.delPhoto()).body.removed).toBe(1);
    expect((await s.pic()).status).toBe(404);
    expect((await s.card()).body.card.shipment.hasPhoto).toBe(false);
  });

  it("needs a saved courier, a courier order, and a small JPEG or WebP", async () => {
    const s = await setup();
    const early = await s.putPhoto(jpeg);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/courier first/i);
    await s.saveCourier({ courier: "TCS" });
    expect((await s.putPhoto(Buffer.alloc(10, 1), "image/png")).status).toBeGreaterThanOrEqual(400);
    expect((await s.putPhoto(Buffer.alloc(700_000, 1))).status).toBeGreaterThanOrEqual(400);

    const local = await setup("local");
    expect((await local.putPhoto(jpeg)).status).toBe(409); // a local order has a rider, not a parcel
  });

  it("stops showing once the card link is revoked, and another owner cannot touch it", async () => {
    const s = await setup();
    await s.saveCourier({ courier: "TCS" });
    await s.putPhoto(jpeg);
    const other = await newVerifiedOwner(t.app, t.mailer, "Other");
    const del = await request(t.app).delete(`/v1/stores/${s.store}/orders/${s.order}/shipment/photo`).set("Cookie", other.cookie);
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect((await s.pic()).status).toBe(200);
    await request(t.app).delete(`/v1/stores/${s.store}/orders/${s.order}/card`).set("Cookie", s.owner.cookie);
    expect((await s.pic()).status).toBe(404);
    expect((await request(t.app).get("/v1/public/card/not-a-real-token-at-all-0000/shipment-photo")).status).toBe(404);
  });

  it("is cleaned up 7 days after its card link ran out, like the rider photo", async () => {
    const s = await setup();
    await s.saveCourier({ courier: "TCS" });
    await s.putPhoto(jpeg);
    const admin = await connect(urls.owner());
    try {
      await admin.query("update shipment_photos set created_at = now() - interval '20 days' where shipment_id = (select id from shipments where order_id = $1)", [s.order]);
      await purgeDeliveryPhotos(t.db);
      const live = await admin.query("select count(*)::int as n from shipment_photos where shipment_id = (select id from shipments where order_id = $1)", [s.order]);
      expect(live.rows[0].n).toBe(1); // the link is still live
      await admin.query("update delivery_cards set expires_at = now() - interval '10 days' where order_id = $1", [s.order]);
      await purgeDeliveryPhotos(t.db);
      const gone = await admin.query("select count(*)::int as n from shipment_photos where shipment_id = (select id from shipments where order_id = $1)", [s.order]);
      expect(gone.rows[0].n).toBe(0);
    } finally {
      await admin.end();
    }
  });
});
