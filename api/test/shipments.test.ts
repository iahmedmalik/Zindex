import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "put", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async () => (await call("post", "/v1/stores", { name: newId("Store") })).body.store.id as string,
    order: async (store: string, kind = "courier") =>
      (await call("post", `/v1/stores/${store}/orders`, { customerName: "Hira", deliveryKind: kind, deliveryCharge: 250, items: [{ name: "Oud", quantity: 1, unitPrice: 6500 }] })).body.order.id as string,
    save: (s: string, o: string, body: object) => call("put", `/v1/stores/${s}/orders/${o}/shipment`, body),
    get: (s: string, o: string) => call("get", `/v1/stores/${s}/orders/${o}/shipment`),
    status: (s: string, o: string, body: object) => call("post", `/v1/stores/${s}/orders/${o}/shipment/status`, body),
    list: (s: string, q = "") => call("get", `/v1/stores/${s}/shipments${q}`),
  };
};

describe("courier shipments", () => {
  it("records a parcel by hand, edits it and keeps a status history", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    expect((await a.get(store, order)).body.shipment).toBeNull();

    const saved = await a.save(store, order, { courier: "TCS", trackingNo: "77881234", trackingUrl: "https://www.tcsexpress.com/track/77881234", shippedOn: "2026-10-28" });
    expect(saved.status).toBe(200);
    expect(saved.body.shipment).toMatchObject({ courier: "TCS", trackingNo: "77881234", shippedOn: "2026-10-28", status: "shipped" });

    expect((await a.save(store, order, { trackingNo: "77881235" })).body.shipment).toMatchObject({ courier: "TCS", trackingNo: "77881235" });
    await a.status(store, order, { status: "delayed" });
    const failed = await a.status(store, order, { status: "failed", failureReason: "Customer not answering" });
    expect(failed.body.shipment).toMatchObject({ status: "failed", failureReason: "Customer not answering" });
    expect(failed.body.events.map((e: { status: string }) => e.status)).toEqual(["shipped", "delayed", "failed"]);
    expect((await a.list(store, "?status=failed")).body.shipments[0]).toMatchObject({ customerName: "Hira", trackingNo: "77881235" });
  });

  it("never makes two shipments for one order or reuses a tracking number", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const one = await a.order(store);
    const two = await a.order(store);
    await a.save(store, one, { courier: "Leopards", trackingNo: "LP1" });
    await a.save(store, one, { courier: "Leopards" });
    expect((await a.list(store)).body.shipments).toHaveLength(1);
    expect((await a.save(store, two, { courier: "leopards", trackingNo: "LP1" })).status).toBe(409);
  });

  it("refuses non-courier orders, missing courier names, bad links and repeated statuses", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    expect((await a.save(store, await a.order(store, "local"), { courier: "TCS" })).status).toBe(409);
    const order = await a.order(store);
    expect((await a.save(store, order, { trackingNo: "X1" })).status).toBe(400);
    expect((await a.save(store, order, { courier: "TCS", trackingUrl: "http://insecure" })).status).toBe(400);
    expect((await a.status(store, order, { status: "delivered" })).status).toBe(404);
    await a.save(store, order, { courier: "TCS" });
    expect((await a.status(store, order, { status: "shipped" })).status).toBe(409);
    expect((await a.status(store, order, { status: "delivered", failureReason: "x" })).status).toBe(400);
  });

  it("is private to the owner", async () => {
    const x = await newVerifiedOwner(t.app, t.mailer);
    const y = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(x.cookie).store();
    const order = await api(x.cookie).order(store);
    await api(x.cookie).save(store, order, { courier: "TCS" });
    expect((await api(y.cookie).get(store, order)).status).toBe(404);
    expect((await api(y.cookie).save(store, order, { courier: "Hacked" })).status).toBe(404);
    expect((await api(y.cookie).list(store)).body.shipments).toHaveLength(0);
  });
});
