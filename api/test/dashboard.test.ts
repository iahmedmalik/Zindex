import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "put", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async (name = newId("Store")) => (await call("post", "/v1/stores", { name })).body.store.id as string,
    order: async (store: string, body: object = {}) =>
      (await call("post", `/v1/stores/${store}/orders`, { customerName: "Buyer", payment: "cod", items: [{ name: "Spice", quantity: 1, unitPrice: 1000 }], ...body })).body.order.id as string,
    status: (s: string, o: string, status: string) => call("post", `/v1/stores/${s}/orders/${o}/status`, { status }),
    rider: (s: string, o: string) => call("put", `/v1/stores/${s}/orders/${o}/delivery`, { riderName: "Imran" }),
    board: () => call("get", "/v1/dashboard"),
  };
};

describe("dashboard", () => {
  it("counts a packed local order as awaiting a rider until a rider name is saved", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store("Food");
    const order = await a.order(store);
    for (const s of ["confirmed", "packed"]) await a.status(store, order, s);
    expect((await a.board()).body.totals.awaitingRider).toBe(1);
    await a.rider(store, order);
    expect((await a.board()).body.totals.awaitingRider).toBe(0);
  });

  it("counts every store separately and together, and says what needs action", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const food = await a.store("Food");
    const shop = await a.store("Shop");

    await a.order(food); // pending
    const toPack = await a.order(food);
    await a.status(food, toPack, "confirmed");
    const packed = await a.order(shop);
    for (const s of ["confirmed", "packed"]) await a.status(shop, packed, s);
    const out = await a.order(shop);
    await a.rider(shop, out);
    for (const s of ["confirmed", "packed", "out_for_delivery"]) await a.status(shop, out, s);
    const cancelled = await a.order(shop); // cancelled orders are left out of today's count
    await a.status(shop, cancelled, "cancelled");

    const { stores, totals } = (await a.board()).body;
    const byName = Object.fromEntries(stores.map((s: { name: string }) => [s.name, s]));
    expect(byName.Food).toMatchObject({ pending: 1, toPack: 1, needsAction: 2, ordersToday: 2, salesToday: 2000 });
    expect(byName.Shop).toMatchObject({ awaitingRider: 1, outForDelivery: 1, cashOutstanding: 1, needsAction: 2, ordersToday: 2, salesToday: 2000 });
    expect(totals).toMatchObject({ pending: 1, toPack: 1, awaitingRider: 1, outForDelivery: 1, cashOutstanding: 1, needsAction: 4, ordersToday: 4 });
  });

  it("shows an owner with no orders zeros, and never mixes owners", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(a.cookie).store();
    await api(a.cookie).order(store);
    await api(b.cookie).store("Quiet");
    const quiet = (await api(b.cookie).board()).body;
    expect(quiet.stores).toHaveLength(1);
    expect(quiet.totals).toMatchObject({ pending: 0, needsAction: 0, ordersToday: 0, salesToday: 0 });
    expect((await request(t.app).get("/v1/dashboard")).status).toBe(401);
  });
});
