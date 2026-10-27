import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

// Products are per store: the same name can cost differently in two stores, and one owner can never
// see or change another owner's catalogue.

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => ({
  store: async (name = newId("Store")) => (await request(t.app).post("/v1/stores").set("Cookie", cookie).send({ name })).body.store.id as string,
  add: (storeId: string, body: object) => request(t.app).post(`/v1/stores/${storeId}/products`).set("Cookie", cookie).send(body),
  list: (storeId: string, q = "") => request(t.app).get(`/v1/stores/${storeId}/products?q=${q}`).set("Cookie", cookie),
});

describe("products", () => {
  it("adds, searches, edits and deletes a product", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const made = await a.add(store, { name: "Garam masala 100 g", price: 450, cost: 300 });
    expect(made.status).toBe(201);
    expect(made.body.product).toMatchObject({ name: "Garam masala 100 g", price: 450, cost: 300, active: true });

    await a.add(store, { name: "Chilli powder", price: 380 });
    expect((await a.list(store)).body.products).toHaveLength(2);
    expect((await a.list(store, "masala")).body.products).toHaveLength(1);

    const id = made.body.product.id as string;
    const edited = await request(t.app).patch(`/v1/stores/${store}/products/${id}`).set("Cookie", o.cookie).send({ price: 500, cost: null });
    expect(edited.body.product).toMatchObject({ price: 500, cost: null, name: "Garam masala 100 g" });

    expect((await request(t.app).delete(`/v1/stores/${store}/products/${id}`).set("Cookie", o.cookie)).status).toBe(204);
    expect((await a.list(store)).body.products).toHaveLength(1);
  });

  it("keeps a separate catalogue and price for each store", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const food = await a.store("Sheen Food");
    const shop = await a.store("The Sheen Store");
    expect((await a.add(food, { name: "Gift box", price: 1000 })).status).toBe(201);
    expect((await a.add(shop, { name: "Gift box", price: 1500 })).status).toBe(201);
    expect((await a.list(food)).body.products[0].price).toBe(1000);
    expect((await a.list(shop)).body.products[0].price).toBe(1500);
    expect((await a.add(food, { name: "gift BOX", price: 1 })).status).toBe(409);
  });

  it("never lets one owner see or change another owner's products", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(a.cookie).store();
    const product = (await api(a.cookie).add(store, { name: "Secret", price: 10 })).body.product;

    expect((await api(b.cookie).list(store)).body.products).toHaveLength(0);
    expect((await api(b.cookie).add(store, { name: "Planted", price: 1 })).status).toBe(404);
    expect((await request(t.app).patch(`/v1/stores/${store}/products/${product.id}`).set("Cookie", b.cookie).send({ price: 1 })).status).toBe(404);
    expect((await request(t.app).delete(`/v1/stores/${store}/products/${product.id}`).set("Cookie", b.cookie)).status).toBe(404);
    expect((await api(a.cookie).list(store)).body.products[0].price).toBe(10);
  });

  it("refuses bad money and unknown fields", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    expect((await a.add(store, { name: "X", price: -1 })).status).toBe(400);
    expect((await a.add(store, { name: "X", price: 10.5 })).status).toBe(400);
    expect((await a.add(store, { name: "", price: 10 })).status).toBe(400);
    expect((await a.add(store, { name: "X", price: 10, ownerId: "other" })).status).toBe(400);
    expect((await request(t.app).get("/v1/stores/nope/products").set("Cookie", o.cookie)).status).toBe(404);
  });
});
