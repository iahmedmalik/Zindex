import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { canMove } from "../src/orders/stages";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "patch", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async (name = newId("Store")) => (await call("post", "/v1/stores", { name })).body.store.id as string,
    product: async (store: string, name: string, price: number) => (await call("post", `/v1/stores/${store}/products`, { name, price })).body.product.id as string,
    order: (store: string, body: object) => call("post", `/v1/stores/${store}/orders`, body),
    get: (store: string, id: string) => call("get", `/v1/stores/${store}/orders/${id}`),
    list: (store: string, query = "") => call("get", `/v1/stores/${store}/orders${query}`),
    edit: (store: string, id: string, body: object) => call("patch", `/v1/stores/${store}/orders/${id}`, body),
    status: (store: string, id: string, status: string) => call("post", `/v1/stores/${store}/orders/${id}/status`, { status }),
    customers: (store: string) => call("get", `/v1/stores/${store}/customers`),
  };
};

describe("order stages", () => {
  it("only moves forward, or to cancelled and returned", () => {
    expect(canMove("pending", "confirmed")).toBe(true);
    expect(canMove("pending", "delivered")).toBe(false);
    expect(canMove("delivered", "returned")).toBe(true);
    expect(canMove("cancelled", "pending")).toBe(false);
    expect(canMove("returned", "confirmed")).toBe(false);
  });
});

describe("orders", () => {
  it("builds an order from catalogue products and calculates the money on the server", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const masala = await a.product(store, "Garam masala", 450);
    const made = await a.order(store, {
      customerName: "Ayesha Khan",
      customerPhone: "+92 300 1234567",
      address: "House 4, Model Town",
      items: [{ productId: masala, quantity: 2 }, { name: "Gift wrap", quantity: 1, unitPrice: 100 }],
      discountPercent: 10,
      deliveryKind: "local",
      riderFee: 350,
      payment: "cod",
      paymentMethod: "cash",
    });
    expect(made.status).toBe(201);
    // subtotal 1000, discount 100, store total 900; the recipient hands the rider 900 + 350.
    expect(made.body.order).toMatchObject({ orderNo: 1, status: "pending", subtotal: 1000, discount: 100, total: 900, riderFee: 350, codAmount: 900, collectAtDoor: 1250, amountDue: 900 });
    expect(made.body.order.items).toHaveLength(2);
    expect(made.body.order.items[0]).toMatchObject({ name: "Garam masala", quantity: 2, unitPrice: 450 });

    const second = await a.order(store, { customerName: "Bilal", items: [{ name: "Thing", quantity: 1, unitPrice: 10 }] });
    expect(second.body.order.orderNo).toBe(2);
  });

  it("ignores any total the phone tries to send", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    expect((await a.order(store, { customerName: "X", items: [{ name: "Y", quantity: 1, unitPrice: 100 }], total: 1 })).status).toBe(400);
  });

  it("saves the customer automatically and reuses them for the next order", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const item = [{ name: "Y", quantity: 1, unitPrice: 100 }];
    const first = await a.order(store, { customerName: "Sana", customerPhone: "0333 1234567", address: "A1", items: item });
    const second = await a.order(store, { customerName: "Sana", customerPhone: "+923331234567", address: "A2", items: item });
    expect(second.body.order.customerId).toBe(first.body.order.customerId);
    const customers = (await a.customers(store)).body.customers;
    expect(customers).toHaveLength(1);
    expect(customers[0].addresses.sort()).toEqual(["A1", "A2"]);
  });

  it("does not make a second order when the same save is sent again", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const body = { customerName: "Retry", idempotencyKey: "retry-key-0001", items: [{ name: "Y", quantity: 1, unitPrice: 100 }] };
    const first = await a.order(store, body);
    const again = await a.order(store, body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.order.id).toBe(first.body.order.id);
    // Two copies sent at the very same moment still make one order.
    const [x, y] = await Promise.all([a.order(store, { ...body, idempotencyKey: "retry-key-0002" }), a.order(store, { ...body, idempotencyKey: "retry-key-0002" })]);
    expect(x.body.order.id).toBe(y.body.order.id);
    expect((await a.list(store)).body.orders).toHaveLength(2);
  });

  it("recalculates every total when the order is edited", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const made = await a.order(store, { customerName: "Edit", payment: "cod", items: [{ name: "Y", quantity: 1, unitPrice: 1000 }] });
    const id = made.body.order.id as string;
    const edited = await a.edit(store, id, { discountPercent: 20, payment: "paid", riderFee: 300, items: [{ name: "Y", quantity: 2, unitPrice: 1000 }] });
    expect(edited.body.order).toMatchObject({ subtotal: 2000, discount: 400, total: 1600, codAmount: 0, amountDue: 0, collectAtDoor: 300 });
  });

  it("moves through the stages and refuses illegal moves", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const id = (await a.order(store, { customerName: "Flow", items: [{ name: "Y", quantity: 1, unitPrice: 10 }] })).body.order.id as string;
    expect((await a.status(store, id, "delivered")).status).toBe(409);
    expect((await a.status(store, id, "confirmed")).body.order.status).toBe("confirmed");
    expect((await a.status(store, id, "cancelled")).body.order.status).toBe("cancelled");
    expect((await a.status(store, id, "pending")).status).toBe(409);
    expect((await a.edit(store, id, { notes: "late" })).status).toBe(409);
  });

  it("searches by customer, phone and order number and filters by stage", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const item = [{ name: "Y", quantity: 1, unitPrice: 10 }];
    await a.order(store, { customerName: "Hira Malik", customerPhone: "03005550001", items: item });
    const second = (await a.order(store, { customerName: "Omar", customerPhone: "03005550002", items: item })).body.order;
    await a.status(store, second.id, "confirmed");
    expect((await a.list(store, "?q=hira")).body.orders).toHaveLength(1);
    expect((await a.list(store, "?q=0300-555-0002")).body.orders[0].customerName).toBe("Omar");
    expect((await a.list(store, "?q=%232")).body.orders[0].customerName).toBe("Omar");
    expect((await a.list(store, "?status=confirmed")).body.orders).toHaveLength(1);
    expect((await a.list(store, "?status=nonsense")).status).toBe(400);
  });

  it("never shows or changes another owner's orders", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(a.cookie).store();
    const id = (await api(a.cookie).order(store, { customerName: "Private", items: [{ name: "Y", quantity: 1, unitPrice: 10 }] })).body.order.id as string;
    expect((await api(b.cookie).list(store)).body.orders).toHaveLength(0);
    expect((await api(b.cookie).get(store, id)).status).toBe(404);
    expect((await api(b.cookie).edit(store, id, { notes: "hacked" })).status).toBe(404);
    expect((await api(b.cookie).status(store, id, "confirmed")).status).toBe(404);
    expect((await api(b.cookie).order(store, { customerName: "Planted", items: [{ name: "Y", quantity: 1, unitPrice: 10 }] })).status).toBe(404);
  });

  it("refuses a product from another store, bad amounts and an empty basket", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const food = await a.store("Food");
    const shop = await a.store("Shop");
    const foreign = await a.product(shop, "Shirt", 2000);
    expect((await a.order(food, { customerName: "X", items: [{ productId: foreign, quantity: 1 }] })).status).toBe(400);
    expect((await a.order(food, { customerName: "X", items: [] })).status).toBe(400);
    expect((await a.order(food, { customerName: "X", items: [{ name: "Y", quantity: 1, unitPrice: 10.5 }] })).status).toBe(400);
    expect((await a.order(food, { customerName: "X", discountPercent: 101, items: [{ name: "Y", quantity: 1, unitPrice: 10 }] })).status).toBe(400);
  });
});
