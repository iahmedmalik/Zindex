import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "put" | "delete", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async () => (await call("post", "/v1/stores", { name: newId("Store") })).body.store.id as string,
    order: async (store: string, body: object = {}) =>
      (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", payment: "cod", riderFee: 300, items: [{ name: "Spice", quantity: 1, unitPrice: 1000 }], ...body })).body.order.id as string,
    get: (s: string, o: string) => call("get", `/v1/stores/${s}/orders/${o}`),
    rider: (s: string, o: string) => call("put", `/v1/stores/${s}/orders/${o}/delivery`, { riderName: "Imran" }),
    status: (s: string, o: string, status: string) => call("post", `/v1/stores/${s}/orders/${o}/status`, { status }),
    confirm: (s: string, o: string) => call("post", `/v1/stores/${s}/orders/${o}/payment/confirm`),
    handover: (s: string, o: string) => call("post", `/v1/stores/${s}/orders/${o}/payment/cash-handover`),
    undo: (s: string, o: string) => call("delete", `/v1/stores/${s}/orders/${o}/payment`),
    summary: (s: string) => call("get", `/v1/stores/${s}/cod-summary`),
  };
};

const sendOut = async (a: ReturnType<typeof api>, store: string, order: string) => {
  for (const s of ["confirmed", "packed", "out_for_delivery"]) await a.status(store, order, s);
};

describe("payments and COD cash", () => {
  it("never marks a payment received by itself, and the owner confirms an advance payment", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store, { payment: "paid", paymentMethod: "jazzcash" });
    expect((await a.get(store, order)).body.order.paymentConfirmedAt).toBeNull();
    expect((await a.confirm(store, order)).body.order.paymentConfirmedAt).toBeTruthy();
    expect((await a.undo(store, order)).body.order.paymentConfirmedAt).toBeNull();
    expect((await a.confirm(store, await a.order(store))).status).toBe(409); // COD is settled by the cash handover
    expect((await a.confirm(store, await a.order(store, { payment: "unpaid" }))).status).toBe(409);
  });

  it("tracks the rider's COD cash from expected to handed over, and lets the owner correct it", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const one = await a.order(store);
    const two = await a.order(store);
    for (const id of [one, two]) {
      await a.rider(store, id);
      await sendOut(a, store, id);
    }
    expect((await a.summary(store)).body).toMatchObject({ expected: 2000, collected: 0, outstanding: 2000 });

    const settled = await a.handover(store, one);
    expect(settled.body.order.paymentConfirmedAt).toBeTruthy();
    const after = (await a.summary(store)).body;
    expect(after).toMatchObject({ expected: 2000, collected: 1000, outstanding: 1000 });
    expect(after.orders).toHaveLength(1);
    expect(after.orders[0].id).toBe(two);

    await a.undo(store, one);
    expect((await a.summary(store)).body.outstanding).toBe(2000);
  });

  it("needs a rider before a handover, and a COD order", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    expect((await a.handover(store, await a.order(store))).status).toBe(409);
    expect((await a.handover(store, await a.order(store, { payment: "paid" }))).status).toBe(409);
  });

  it("is private to the owner", async () => {
    const x = await newVerifiedOwner(t.app, t.mailer);
    const y = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(x.cookie).store();
    const order = await api(x.cookie).order(store, { payment: "paid" });
    expect((await api(y.cookie).confirm(store, order)).status).toBe(404);
    expect((await api(y.cookie).undo(store, order)).status).toBe(404);
    expect((await api(y.cookie).summary(store)).body.expected).toBe(0);
  });
});
