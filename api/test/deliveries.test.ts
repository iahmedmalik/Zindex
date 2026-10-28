import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "put", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async () => (await call("post", "/v1/stores", { name: newId("Store"), address: "Shop 3, Main Market, Lahore", phone: "0300 0000000" })).body.store.id as string,
    order: async (store: string, body: object = {}) =>
      (await call("post", `/v1/stores/${store}/orders`, {
        customerName: "Ayesha", customerPhone: "03001234567", address: "House 4, Model Town", payment: "cod", riderFee: 350,
        items: [{ name: "Garam masala", quantity: 2, unitPrice: 450 }], ...body,
      })).body.order.id as string,
    get: (s: string, o: string) => call("get", `/v1/stores/${s}/orders/${o}/delivery`),
    save: (s: string, o: string, body: object) => call("put", `/v1/stores/${s}/orders/${o}/delivery`, body),
  };
};

describe("local delivery", () => {
  it("has no rider until one is saved, and offers no ready-made text for inDrive or Yango", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    const got = await a.get(store, order);
    expect(got.status).toBe(200);
    expect(got.body.delivery).toBeNull();
    expect(got.body).not.toHaveProperty("copyText");
  });

  it("records the rider by hand, and saving it changes only the rider's details", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    const saved = await a.save(store, order, { service: "yango", riderName: "Imran", riderPhone: "+92 321 7654321", bikeNumber: "LEA-1234" });
    expect(saved.status).toBe(200);
    expect(saved.body.delivery).toMatchObject({ service: "yango", riderName: "Imran", riderPhone: "03217654321", bikeNumber: "LEA-1234" });

    // A second save changes only the fields sent.
    const later = await a.save(store, order, { notes: "Gate is blue" });
    expect(later.body.delivery).toMatchObject({ riderName: "Imran", notes: "Gate is blue" });
  });

  it("refuses pickup and courier orders, and bad rider fields", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    expect((await a.save(store, await a.order(store, { deliveryKind: "courier" }), { riderName: "X" })).status).toBe(409);
    expect((await a.save(store, await a.order(store), { riderPhotoUrl: "http://insecure.example/x.jpg" })).status).toBe(400);
    expect((await a.save(store, await a.order(store), { ownerId: "x" })).status).toBe(400);
  });

  it("is private to the owner", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(a.cookie).store();
    const order = await api(a.cookie).order(store);
    await api(a.cookie).save(store, order, { riderName: "Imran" });
    expect((await api(b.cookie).get(store, order)).status).toBe(404);
    expect((await api(b.cookie).save(store, order, { riderName: "Hacker" })).status).toBe(404);
    expect((await api(a.cookie).get(store, order)).body.delivery.riderName).toBe("Imran");
  });
});
