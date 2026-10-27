import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

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
