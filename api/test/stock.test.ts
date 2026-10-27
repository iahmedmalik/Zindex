import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { asOwner, buildTestApp, connect, denied, newId, newVerifiedOwner, urls } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "patch", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async () => (await call("post", "/v1/stores", { name: newId("Store") })).body.store.id as string,
    product: async (store: string, name: string, price = 100) => (await call("post", `/v1/stores/${store}/products`, { name, price })).body.product.id as string,
    adjust: (store: string, productId: string, delta: number, note?: string) => call("post", `/v1/stores/${store}/stock/adjust`, { productId, delta, note }),
    stock: async (store: string) => (await call("get", `/v1/stores/${store}/stock`)).body.stock as { productId: string; onHand: number; unitsSold: number }[],
    history: (store: string, productId: string) => call("get", `/v1/stores/${store}/stock/${productId}/history`),
    order: (store: string, items: object[]) => call("post", `/v1/stores/${store}/orders`, { customerName: "Buyer", items }),
    status: (store: string, id: string, status: string) => call("post", `/v1/stores/${store}/orders/${id}/status`, { status }),
    restore: (store: string, id: string) => call("post", `/v1/stores/${store}/orders/${id}/restore-stock`),
    edit: (store: string, id: string, body: object) => call("patch", `/v1/stores/${store}/orders/${id}`, body),
  };
};

describe("stock ledger", () => {
  it("starts at zero, moves by hand and keeps a history", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const p = await a.product(store, "Saffron");
    expect((await a.stock(store))[0]).toMatchObject({ onHand: 0, unitsSold: 0 });
    await a.adjust(store, p, 30, "Received from supplier");
    await a.adjust(store, p, -2, "Spilled");
    expect((await a.stock(store))[0]!.onHand).toBe(28);
    const history = (await a.history(store, p)).body.history;
    expect(history.map((h: { delta: number }) => h.delta)).toEqual([-2, 30]);
    expect((await a.adjust(store, p, 0)).status).toBe(400);
  });

  it("does not touch stock while an order is only entered, and deducts once when it is confirmed", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const p = await a.product(store, "Saffron");
    await a.adjust(store, p, 10);
    const id = (await a.order(store, [{ productId: p, quantity: 3 }, { productId: p, quantity: 2 }])).body.order.id as string;
    expect((await a.stock(store))[0]!.onHand).toBe(10);

    const confirmed = await a.status(store, id, "confirmed");
    expect(confirmed.body.order.stockApplied).toBe(true);
    expect(confirmed.body.stockWarnings).toEqual([]);
    expect((await a.stock(store))[0]).toMatchObject({ onHand: 5, unitsSold: 5 });

    // Sending the same move again, or moving on, never deducts a second time.
    expect((await a.status(store, id, "confirmed")).status).toBe(409);
    await a.status(store, id, "packed");
    expect((await a.stock(store))[0]!.onHand).toBe(5);
  });

  it("sells below zero but warns", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const p = await a.product(store, "Saffron");
    await a.adjust(store, p, 1);
    const id = (await a.order(store, [{ productId: p, quantity: 4 }])).body.order.id as string;
    const confirmed = await a.status(store, id, "confirmed");
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.stockWarnings).toEqual([{ productId: p, name: "Saffron", onHand: -3 }]);
  });

  it("locks the items once confirmed, and puts stock back only when the owner approves", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const p = await a.product(store, "Saffron");
    await a.adjust(store, p, 10);
    const id = (await a.order(store, [{ productId: p, quantity: 4 }])).body.order.id as string;
    await a.status(store, id, "confirmed");
    expect((await a.edit(store, id, { items: [{ productId: p, quantity: 1 }] })).status).toBe(409);
    expect((await a.restore(store, id)).status).toBe(409); // not cancelled yet

    await a.status(store, id, "cancelled");
    expect((await a.stock(store))[0]!.onHand).toBe(6); // cancelling alone does not restock
    const restored = await a.restore(store, id);
    expect(restored.status).toBe(200);
    expect(restored.body.restored).toBe(1);
    expect((await a.stock(store))[0]).toMatchObject({ onHand: 10, unitsSold: 0 });
    expect((await a.restore(store, id)).status).toBe(409); // cannot restore twice
    expect((await a.stock(store))[0]!.onHand).toBe(10);
  });

  it("ignores typed items that are not in the catalogue", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const id = (await a.order(store, [{ name: "Custom thing", quantity: 1, unitPrice: 50 }])).body.order.id as string;
    expect((await a.status(store, id, "confirmed")).status).toBe(200);
  });

  it("is append-only and private to the owner", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(a.cookie).store();
    const p = await api(a.cookie).product(store, "Saffron");
    await api(a.cookie).adjust(store, p, 5);
    expect((await api(b.cookie).adjust(store, p, 100)).status).toBe(404);
    expect((await api(b.cookie).stock(store))).toHaveLength(0);
    expect((await api(b.cookie).history(store, p)).body.history).toHaveLength(0);
    expect((await api(a.cookie).stock(store))[0]!.onHand).toBe(5);
  });
});

describe("stock ledger at the database", () => {
  it("lets the app role neither edit nor delete a movement", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const p = await a.product(store, "Saffron");
    await a.adjust(store, p, 5);
    const app = await connect(urls.app());
    try {
      await asOwner(app, o.id, async () => {
        expect(await denied(app.query("update stock_movements set delta = 500 where product_id = $1", [p]))).toBe(true);
      });
      await asOwner(app, o.id, async () => {
        expect(await denied(app.query("delete from stock_movements where product_id = $1", [p]))).toBe(true);
      });
    } finally {
      await app.end();
    }
  });
});
