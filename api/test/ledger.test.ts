import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());
const day = (offset = 0) => new Date(Date.now() + 5 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "patch" | "delete", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async () => (await call("post", "/v1/stores", { name: newId("Store") })).body.store.id as string,
    order: async (store: string, body: object = {}) =>
      (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", customerPhone: "03001234567", items: [{ name: "Spice", quantity: 1, unitPrice: 1000 }], ...body })).body.order.id as string,
    get: async (store: string, order: string) => (await call("get", `/v1/stores/${store}/orders/${order}`)).body.order,
    move: async (store: string, order: string, ...steps: string[]) => { for (const s of steps) await call("post", `/v1/stores/${store}/orders/${order}/status`, { status: s }); },
    pay: (store: string, order: string, body: object) => call("post", `/v1/stores/${store}/orders/${order}/payments`, body),
    undo: (store: string, order: string, id: string) => call("delete", `/v1/stores/${store}/orders/${order}/payments/${id}`),
    ledger: (store: string, order: string) => call("get", `/v1/stores/${store}/orders/${order}/payments`),
    cash: async (store: string, query = "") => ((await call("get", `/v1/stores/${store}/orders?view=cash${query}`)).body.orders as { id: string }[]).map((o) => o.id),
    summary: async (store: string) => (await call("get", `/v1/stores/${store}/cod-summary`)).body,
    confirm: (store: string, order: string) => call("post", `/v1/stores/${store}/orders/${order}/payment/confirm`),
    edit: (store: string, order: string, body: object) => call("patch", `/v1/stores/${store}/orders/${order}`, body),
    del: (store: string, order: string) => call("delete", `/v1/stores/${store}/orders/${order}`),
    received: async (from: string, to: string) => (await call("get", `/v1/reports/received?from=${from}&to=${to}`)).body,
    whatsapp: (store: string, order: string, template: string) => call("get", `/v1/stores/${store}/orders/${order}/whatsapp?template=${template}`),
    board: async () => (await call("get", "/v1/dashboard")).body,
  };
};
const OUT_AND_DELIVERED = ["confirmed", "packed", "out_for_delivery", "delivered"];

describe("pay later: paid to the shop in chunks", () => {
  it("shows up in Cash to collect once delivered, takes chunks, refuses too much, settles, and can be undone", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store, { payment: "unpaid", riderFee: 300 }); // total 1,000: the customer pays the rider only his fee at the door

    await a.move(store, order, "confirmed", "packed", "out_for_delivery");
    expect(await a.cash(store)).toEqual([]); // not yet: it appears once delivered
    await a.move(store, order, "delivered");
    expect((await a.get(store, order)).deliveredAt).toBeTruthy();
    expect(await a.cash(store)).toEqual([order]);
    expect((await a.summary(store)).buckets).toMatchObject({ customers: { orders: 1, amount: 1000 }, riders: { orders: 0 }, couriers: { orders: 0 } });
    expect((await a.board()).totals.cashOutstanding).toBe(1);

    const first = await a.pay(store, order, { amount: 400, method: "Easypaisa" });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ expected: 1000, paid: 400, balance: 600 });
    expect((await a.get(store, order)).paymentConfirmedAt).toBeNull(); // not paid in full yet
    expect(await a.cash(store)).toEqual([order]); // still owing
    expect((await a.summary(store)).outstanding).toBe(600);

    const tooMuch = await a.pay(store, order, { amount: 700 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toMatch(/more than the PKR 600/);

    const last = await a.pay(store, order, { amount: 600, method: "Bank transfer", receivedOn: day(-2) }); // a transfer that came in two days ago
    expect(last.body).toMatchObject({ paid: 1000, balance: 0 });
    expect((await a.get(store, order)).paymentConfirmedAt).toBeTruthy();
    expect(await a.cash(store)).toEqual([]);
    expect((await a.summary(store)).buckets.customers).toEqual({ orders: 0, amount: 0 });

    const lastId = last.body.payments.at(-1).id as string;
    const undone = await a.undo(store, order, lastId);
    expect(undone.body).toMatchObject({ paid: 400, balance: 600 });
    expect((await a.get(store, order)).paymentConfirmedAt).toBeNull();
    expect(await a.cash(store)).toEqual([order]);
  });

  it("says what is still to pay in the reminder message, and the customer's card knows what has been paid", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store, { payment: "unpaid" });
    await a.move(store, order, ...OUT_AND_DELIVERED);
    await a.pay(store, order, { amount: 250 });
    const reminder = (await a.whatsapp(store, order, "payment_reminder")).body;
    expect(decodeURIComponent(reminder.waLink)).toContain("PKR 750"); // what is left, not the whole total
    const link = (await request(t.app).get(`/v1/stores/${store}/orders/${order}/card`).set("Cookie", o.cookie)).body.card.url as string;
    const card = (await request(t.app).get(`/v1/public/card/${link.split("/c/")[1]}`)).body.card;
    expect(card.order).toMatchObject({ payment: "unpaid", total: 1000, paid: 250 });
  });
});

describe("cash on delivery: in chunks from a rider or a courier", () => {
  it("keeps two buckets, with riders and with couriers, and records chunks against each", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const byRider = await a.order(store, { payment: "cod", riderFee: 300 }); // the store expects 1,000; the rider's 300 is not the store's
    const byCourier = await a.order(store, { payment: "cod", deliveryKind: "courier", deliveryCharge: 200 }); // 1,200
    await a.move(store, byRider, "confirmed");
    expect((await a.pay(store, byRider, { amount: 100 })).status).toBe(409); // the cash is with the rider only once the order is out
    await a.move(store, byRider, "packed", "out_for_delivery");
    await a.move(store, byCourier, ...OUT_AND_DELIVERED);

    expect((await a.summary(store)).buckets).toMatchObject({ riders: { orders: 1, amount: 1000 }, couriers: { orders: 1, amount: 1200 }, customers: { orders: 0 } });
    expect(await a.cash(store, "&bucket=riders")).toEqual([byRider]);
    expect(await a.cash(store, "&bucket=couriers")).toEqual([byCourier]);

    expect((await a.pay(store, byRider, { amount: 300, method: "Cash" })).body).toMatchObject({ paid: 300, balance: 700 });
    expect((await a.pay(store, byCourier, { amount: 500, method: "Bank transfer" })).body).toMatchObject({ paid: 500, balance: 700 });
    expect((await a.summary(store)).buckets).toMatchObject({ riders: { amount: 700 }, couriers: { amount: 700 } });
    await a.pay(store, byRider, { amount: 700 });
    expect(await a.cash(store, "&bucket=riders")).toEqual([]);
    expect((await a.get(store, byRider)).paymentConfirmedAt).toBeTruthy();
  });
});

describe("paid in advance and the one-tap buttons", () => {
  it("records a payment seen as one full payment, and shows it in the ledger", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store, { payment: "paid", paymentMethod: "easypaisa" });
    expect((await a.confirm(store, order)).status).toBe(200);
    const ledger = (await a.ledger(store, order)).body;
    expect(ledger).toMatchObject({ expected: 1000, paid: 1000, balance: 0 });
    expect(ledger.payments).toHaveLength(1);
    expect(ledger.payments[0]).toMatchObject({ amount: 1000, method: "easypaisa" });
  });
});

describe("rules around payments", () => {
  it("an order with a payment cannot change its amounts until the payments are undone", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store, { payment: "unpaid" });
    await a.pay(store, order, { amount: 100 });
    expect((await a.edit(store, order, { discountPercent: 10 })).body.error).toMatch(/Undo them first/);
    expect((await a.edit(store, order, { notes: "just a note" })).status).toBe(200); // details that are not amounts are fine
  });

  it("is private to the owner, and refuses a bad amount or a future date", async () => {
    const x = await newVerifiedOwner(t.app, t.mailer);
    const y = await newVerifiedOwner(t.app, t.mailer);
    const a = api(x.cookie);
    const store = await a.store();
    const order = await a.order(store, { payment: "unpaid" });
    expect((await api(y.cookie).pay(store, order, { amount: 10 })).status).toBe(404);
    expect((await api(y.cookie).ledger(store, order)).status).toBe(404);
    expect((await a.pay(store, order, { amount: 0 })).status).toBe(400);
    expect((await a.pay(store, order, { amount: 10.5 })).status).toBe(400);
    expect((await a.pay(store, order, { amount: 10, receivedOn: day(3) })).status).toBe(400);
    expect((await a.ledger(store, order)).body.paid).toBe(0);
  });
});

describe("money received", () => {
  it("counts payments by the day they came in, by method and by store", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store, { payment: "unpaid" });
    await a.pay(store, order, { amount: 300, method: "Easypaisa", receivedOn: day(-3) });
    await a.pay(store, order, { amount: 200, method: "Cash", receivedOn: day(0) });

    const all = await a.received(day(-3), day(0));
    expect(all).toMatchObject({ total: 500, payments: 2 });
    expect(all.byMethod).toEqual([{ name: "Easypaisa", amount: 300 }, { name: "Cash", amount: 200 }]);
    expect(all.byStore).toHaveLength(1);
    expect((await a.received(day(0), day(0))).total).toBe(200); // only what came in today
    expect((await a.received(day(-10), day(-5))).total).toBe(0);
  });
});
