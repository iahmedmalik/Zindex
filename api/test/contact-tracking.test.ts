import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { purgeDeliveryPhotos } from "../src/maintenance";
import { buildTestApp, connect, newId, newVerifiedOwner, urls } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "put" | "patch", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    makeStore: (body: object = {}) => call("post", "/v1/stores", { name: newId("Store"), phone: "0300 1112233", ...body }),
    order: async (store: string) =>
      (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", customerPhone: "03001234567", address: "House 4", payment: "cod", riderFee: 350, items: [{ name: "Honey", quantity: 2, unitPrice: 450 }] })).body.order.id as string,
    rename: (store: string, body: object) => call("patch", `/v1/stores/${store}`, body),
    save: (s: string, o: string, body: object) => call("put", `/v1/stores/${s}/orders/${o}/delivery`, body),
    card: async (s: string, o: string) => (await call("post", `/v1/stores/${s}/orders/${o}/card`, {})).body.token as string,
  };
};

const open = (token: string) => request(t.app).get(`/v1/public/card/${token}`);

describe("store email", () => {
  it("is optional, can be set and changed, and must look like an email", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const bare = await a.makeStore();
    expect(bare.status).toBe(201);
    expect(bare.body.store.email).toBeNull();

    const withMail = await a.makeStore({ email: "hello@sheenfood.pk", address: "Shop 4, Model Town" });
    expect(withMail.body.store).toMatchObject({ email: "hello@sheenfood.pk", address: "Shop 4, Model Town" });

    const changed = await a.rename(bare.body.store.id, { email: "orders@sheen.pk" });
    expect(changed.body.store.email).toBe("orders@sheen.pk");

    expect((await a.rename(bare.body.store.id, { email: "not-an-email" })).status).toBe(400);
  });
});

describe("rider photo time and tracking link", () => {
  it("are optional and saved with the rider details", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = (await a.makeStore()).body.store.id as string;
    const order = await a.order(store);

    const plain = await a.save(store, order, { riderName: "Bilal" });
    expect(plain.body.delivery).toMatchObject({ riderName: "Bilal", riderPhotoUrl: null, riderPhotoTakenAt: null, trackingUrl: null });

    const full = await a.save(store, order, {
      riderPhotoUrl: "https://files.example/rider.jpg",
      riderPhotoTakenAt: "2026-10-28T15:52:00.000Z",
      trackingUrl: "https://indrive.example/trip/abc123",
    });
    expect(full.status).toBe(200);
    expect(full.body.delivery).toMatchObject({ riderName: "Bilal", trackingUrl: "https://indrive.example/trip/abc123", riderPhotoUrl: "https://files.example/rider.jpg" });
    expect(new Date(full.body.delivery.riderPhotoTakenAt).toISOString()).toBe("2026-10-28T15:52:00.000Z");
  });

  it("refuses a tracking link that is not https, and a photo time that is not a date", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = (await a.makeStore()).body.store.id as string;
    const order = await a.order(store);
    expect((await a.save(store, order, { trackingUrl: "http://indrive.example/trip/1" })).status).toBe(400);
    expect((await a.save(store, order, { trackingUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await a.save(store, order, { riderPhotoTakenAt: "yesterday" })).status).toBe(400);
  });

  it("can be cleared again", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = (await a.makeStore()).body.store.id as string;
    const order = await a.order(store);
    await a.save(store, order, { trackingUrl: "https://indrive.example/trip/1" });
    const cleared = await a.save(store, order, { trackingUrl: null });
    expect(cleared.body.delivery.trackingUrl).toBeNull();
  });
});

describe("the public delivery card", () => {
  it("carries the store's email and address and the delivery's tracking link and photo time, and still no customer phone", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = (await a.makeStore({ email: "hello@sheenfood.pk", address: "Shop 4, Model Town" })).body.store.id as string;
    const order = await a.order(store);
    await a.save(store, order, {
      riderName: "Bilal", riderPhotoUrl: "https://files.example/rider.jpg", riderPhotoTakenAt: "2026-10-28T15:52:00.000Z", trackingUrl: "https://indrive.example/trip/abc123",
    });
    const card = await open(await a.card(store, order));
    expect(card.status).toBe(200);
    expect(card.body.card.store).toMatchObject({ phone: "0300 1112233", email: "hello@sheenfood.pk", address: "Shop 4, Model Town" });
    expect(card.body.card.delivery).toMatchObject({ riderName: "Bilal", trackingUrl: "https://indrive.example/trip/abc123", riderPhotoUrl: "https://files.example/rider.jpg" });
    expect(card.body.card.delivery.riderPhotoTakenAt).toBeTruthy();
    expect(JSON.stringify(card.body)).not.toContain("03001234567");
  });

  it("still works when the photo and the tracking link were skipped", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = (await a.makeStore()).body.store.id as string;
    const order = await a.order(store);
    await a.save(store, order, { riderName: "Bilal" });
    const card = await open(await a.card(store, order));
    expect(card.status).toBe(200);
    expect(card.body.card.store.email).toBeNull();
    expect(card.body.card.delivery).toMatchObject({ riderName: "Bilal", riderPhotoUrl: null, riderPhotoTakenAt: null, trackingUrl: null });
  });

  it("does not let another owner change this order's tracking link", async () => {
    const owner = await newVerifiedOwner(t.app, t.mailer);
    const other = await newVerifiedOwner(t.app, t.mailer);
    const a = api(owner.cookie);
    const store = (await a.makeStore()).body.store.id as string;
    const order = await a.order(store);
    await a.save(store, order, { riderName: "Bilal", trackingUrl: "https://indrive.example/trip/1" });
    const attack = await api(other.cookie).save(store, order, { trackingUrl: "https://evil.example/" });
    expect([403, 404]).toContain(attack.status);
    const card = await open(await a.card(store, order));
    expect(card.body.card.delivery.trackingUrl).toBe("https://indrive.example/trip/1");
  });
});

describe("the rider photo", () => {
  // The smallest valid-looking JPEG header is enough: the server checks type and size, not pixels.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
  const put = (cookie: string, s: string, o: string, body: Buffer, type = "image/jpeg") =>
    request(t.app).put(`/v1/stores/${s}/orders/${o}/delivery/photo`).set("Cookie", cookie).set("Content-Type", type).send(body);
  const setup = async () => {
    const owner = await newVerifiedOwner(t.app, t.mailer);
    const a = api(owner.cookie);
    const store = (await a.makeStore()).body.store.id as string;
    const order = await a.order(store);
    await a.save(store, order, { riderName: "Bilal" });
    return { owner, a, store, order };
  };

  it("is uploaded by the owner, shown on the card through its link, and can be replaced and removed", async () => {
    const { owner, a, store, order } = await setup();
    const up = await put(owner.cookie, store, order, jpeg);
    expect(up.status).toBe(200);
    const mine = await request(t.app).get(`/v1/stores/${store}/orders/${order}/delivery`).set("Cookie", owner.cookie);
    expect(mine.body.delivery.hasPhoto).toBe(true);

    const token = await a.card(store, order);
    const card = await open(token);
    expect(card.body.card.delivery.hasPhoto).toBe(true);
    expect(card.body.card.delivery.riderPhotoTakenAt).toBeTruthy();

    const pic = await request(t.app).get(`/v1/public/card/${token}/photo`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect(pic.status).toBe(200);
    expect(pic.headers["content-type"]).toBe("image/jpeg");
    expect(pic.headers["cache-control"]).toBe("no-store");
    expect(Buffer.compare(pic.body as Buffer, jpeg)).toBe(0);

    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(500, 1)]);
    expect((await put(owner.cookie, store, order, webp, "image/webp")).status).toBe(200);

    const gone = await request(t.app).delete(`/v1/stores/${store}/orders/${order}/delivery/photo`).set("Cookie", owner.cookie);
    expect(gone.body.removed).toBe(1);
    expect((await request(t.app).get(`/v1/public/card/${token}/photo`)).status).toBe(404);
    expect((await open(token)).body.card.delivery.hasPhoto).toBe(false);
  });

  it("refuses other file types, an empty file and a file over 600 KB", async () => {
    const { owner, store, order } = await setup();
    expect((await put(owner.cookie, store, order, Buffer.from("<svg/>"), "image/svg+xml")).status).toBe(400);
    expect((await put(owner.cookie, store, order, Buffer.alloc(0))).status).toBe(400);
    expect((await put(owner.cookie, store, order, Buffer.alloc(700_000, 1))).status).toBe(413);
  });

  it("is not served for a revoked link, and another owner cannot read, replace or remove it", async () => {
    const { owner, a, store, order } = await setup();
    await put(owner.cookie, store, order, jpeg);
    const token = await a.card(store, order);
    const other = await newVerifiedOwner(t.app, t.mailer);
    expect([403, 404]).toContain((await put(other.cookie, store, order, jpeg)).status);
    const del = await request(t.app).delete(`/v1/stores/${store}/orders/${order}/delivery/photo`).set("Cookie", other.cookie);
    expect(del.body.removed ?? 0).toBe(0);
    expect((await request(t.app).get(`/v1/public/card/${token}/photo`)).status).toBe(200);
    await request(t.app).delete(`/v1/stores/${store}/orders/${order}/card`).set("Cookie", owner.cookie);
    expect((await request(t.app).get(`/v1/public/card/${token}/photo`)).status).toBe(404);
    expect((await request(t.app).get(`/v1/public/card/not-a-real-token-at-all-0000/photo`)).status).toBe(404);
  });
});

describe("rider photo cleanup", () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
  const withPhoto = async () => {
    const owner = await newVerifiedOwner(t.app, t.mailer);
    const a = api(owner.cookie);
    const store = (await a.makeStore()).body.store.id as string;
    const order = await a.order(store);
    await a.save(store, order, { riderName: "Bilal" });
    await request(t.app).put(`/v1/stores/${store}/orders/${order}/delivery/photo`).set("Cookie", owner.cookie).set("Content-Type", "image/jpeg").send(jpeg);
    return { a, store, order };
  };
  // The test database owner may change dates directly, as an admin would; the app role cannot.
  const age = async (order: string, photoDays: number, cardExpiredDays: number | null) => {
    const admin = await connect(urls.owner());
    await admin.query("update delivery_photos set created_at = now() - make_interval(days => $2) where delivery_id = (select id from deliveries where order_id = $1)", [order, photoDays]);
    if (cardExpiredDays !== null) await admin.query("update delivery_cards set expires_at = now() - make_interval(days => $2) where order_id = $1", [order, cardExpiredDays]);
    const left = await admin.query("select count(*)::int as n from delivery_photos where delivery_id = (select id from deliveries where order_id = $1)", [order]);
    await admin.end();
    return left.rows[0].n as number;
  };
  const photos = async (order: string) => {
    const admin = await connect(urls.owner());
    const r = await admin.query("select count(*)::int as n from delivery_photos where delivery_id = (select id from deliveries where order_id = $1)", [order]);
    await admin.end();
    return r.rows[0].n as number;
  };

  it("removes a photo 7 days after its card link ran out, and keeps one whose link is live or recent", async () => {
    const live = await withPhoto();
    await live.a.card(live.store, live.order);
    await age(live.order, 20, null); // photo is old, but the link is still live
    const recent = await withPhoto();
    await recent.a.card(recent.store, recent.order);
    await age(recent.order, 20, 3); // link ran out 3 days ago
    const gone = await withPhoto();
    await gone.a.card(gone.store, gone.order);
    await age(gone.order, 20, 10); // link ran out 10 days ago
    const noCard = await withPhoto();
    await age(noCard.order, 20, null); // never had a link, photo is old

    const removed = await purgeDeliveryPhotos(t.db);
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await photos(live.order)).toBe(1);
    expect(await photos(recent.order)).toBe(1);
    expect(await photos(gone.order)).toBe(0);
    expect(await photos(noCard.order)).toBe(0);
  });

  it("keeps a fresh photo that has no link yet", async () => {
    const fresh = await withPhoto();
    await purgeDeliveryPhotos(t.db);
    expect(await photos(fresh.order)).toBe(1);
  });
});
