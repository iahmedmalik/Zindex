import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());
const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "patch" | "delete", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async () => (await call("post", "/v1/stores", { name: newId("Store"), invoicePrefix: "SF" })).body.store.id as string,
    product: async (store: string, name: string, price: number, cost?: number) =>
      (await call("post", `/v1/stores/${store}/products`, { name, price, ...(cost === undefined ? {} : { cost }) })).body.product.id as string,
    products: async (store: string) => (await call("get", `/v1/stores/${store}/products`)).body.products as { id: string; price: number }[],
    deleteProduct: (store: string, product: string) => call("delete", `/v1/stores/${store}/products/${product}`),
    order: async (store: string, body: object = {}) => (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", items: [{ name: "Spice", quantity: 1, unitPrice: 1000 }], ...body })).body.order.id as string,
    get: (store: string, order: string) => call("get", `/v1/stores/${store}/orders/${order}`),
    del: (store: string, order: string, body?: object) => call("delete", `/v1/stores/${store}/orders/${order}`, body),
    stock: async (store: string) => (await call("get", `/v1/stores/${store}/stock`)).body.stock as { productId: string; onHand: number }[],
    status: (store: string, order: string, status: string) => call("post", `/v1/stores/${store}/orders/${order}/status`, { status }),
    invoice: async (store: string, order: string) => (await call("get", `/v1/stores/${store}/orders/${order}/invoice`)).body.invoice?.number as string,
    adjust: (store: string, productId: string, delta: number) => call("post", `/v1/stores/${store}/stock/adjust`, { productId, delta }),
    sales: async () => (await call("get", `/v1/reports/sales?from=${today}&to=${today}`)).body,
    card: (store: string, order: string) => call("get", `/v1/stores/${store}/orders/${order}/card`),
    confirmPayment: (store: string, order: string) => call("post", `/v1/stores/${store}/orders/${order}/payment/confirm`),
  };
};

describe("deleting a product", () => {
  it("changes no number from before: the old orders keep their lines, sales, profit and invoices", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const masala = await a.product(store, "Masala", 500, 300);
    const order = await a.order(store, { discountPercent: 10, items: [{ productId: masala, quantity: 2 }, { name: "Gift box", quantity: 1, unitPrice: 1000, unitCost: 600 }] });
    const before = { sales: await a.sales(), order: (await a.get(store, order)).body.order, invoice: await a.invoice(store, order) };

    expect((await a.deleteProduct(store, masala)).status).toBe(204);

    const after = { sales: await a.sales(), order: (await a.get(store, order)).body.order, invoice: await a.invoice(store, order) };
    expect(after.sales.stores).toEqual(before.sales.stores); // net sales, cost of goods, profit and missing costs: all the same
    expect(after.sales.totals).toEqual(before.sales.totals);
    expect(after.sales.bestSellers).toEqual(before.sales.bestSellers);
    expect(after.invoice).toBe(before.invoice);
    expect(after.order.total).toBe(before.order.total);
    expect(after.order.items.map((i: { name: string; quantity: number; unitPrice: number; unitCost: number | null }) => [i.name, i.quantity, i.unitPrice, i.unitCost])).toEqual([["Masala", 2, 500, 300], ["Gift box", 1, 1000, 600]]);
    expect((await a.products(store)).map((p) => p.id)).not.toContain(masala); // it is gone from the catalogue
  });

  it("is private to the owner", async () => {
    const x = await newVerifiedOwner(t.app, t.mailer);
    const y = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(x.cookie).store();
    const product = await api(x.cookie).product(store, "Masala", 500);
    expect((await api(y.cookie).deleteProduct(store, product)).status).toBe(404);
    expect((await api(x.cookie).products(store)).map((p) => p.id)).toContain(product);
  });
});

describe("a price edited on an order", () => {
  it("applies to that order only: the product keeps its price", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const masala = await a.product(store, "Masala", 500, 300);
    const order = await a.order(store, { items: [{ productId: masala, quantity: 1, unitPrice: 400 }] });
    expect((await a.get(store, order)).body.order.items[0].unitPrice).toBe(400);
    expect((await a.products(store)).find((p) => p.id === masala)!.price).toBe(500);
    const next = await a.order(store, { items: [{ productId: masala, quantity: 1 }] });
    expect((await a.get(store, next)).body.order.items[0].unitPrice).toBe(500); // the next order starts from the catalogue price again
  });
});

describe("deleting an order", () => {
  it("removes an order that has the store's latest invoice number, and gives the number back", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const keep = await a.order(store);
    const mistake = await a.order(store);
    const number = await a.invoice(store, mistake);
    expect((await a.get(store, mistake)).body.onDelete).toEqual({ stockOut: false, payments: 0, invoiceNumber: number, numberComesBack: true });

    const gone = await a.del(store, mistake);
    expect(gone.status).toBe(200);
    expect(gone.body).toEqual({ deleted: true, invoiceNumberReleased: true, stockPutBack: false });
    expect((await a.get(store, mistake)).status).toBe(404);
    expect((await a.sales()).totals.orders).toBe(1);
    const next = await a.order(store);
    expect(await a.invoice(store, next)).toBe(number); // no gap: the new order takes the number that was given back
    expect(await a.invoice(store, keep)).not.toBe(number);
  });

  it("deletes an older order too: its number stays missing, and the card says so beforehand", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const older = await a.order(store);
    const olderNumber = await a.invoice(store, older);
    const newer = await a.order(store);
    const newerNumber = await a.invoice(store, newer);
    expect((await a.get(store, older)).body.onDelete).toMatchObject({ invoiceNumber: olderNumber, numberComesBack: false });

    const gone = await a.del(store, older);
    expect(gone.status).toBe(200);
    expect(gone.body.invoiceNumberReleased).toBe(false);
    expect((await a.get(store, older)).status).toBe(404);
    const after = await a.order(store);
    const afterNumber = await a.invoice(store, after);
    expect(afterNumber).not.toBe(olderNumber); // a number is never handed out twice
    expect(afterNumber).not.toBe(newerNumber);
  });

  it("deletes a delivered, paid order too, with its payments", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const paid = await a.order(store, { payment: "paid", paymentMethod: "easypaisa" });
    await a.confirmPayment(store, paid);
    for (const s of ["confirmed", "packed", "out_for_delivery", "delivered"]) await a.status(store, paid, s);
    expect((await a.get(store, paid)).body.onDelete.payments).toBeGreaterThan(0);

    expect((await a.del(store, paid)).status).toBe(200);
    expect((await a.get(store, paid)).status).toBe(404);
    expect((await a.sales()).totals.orders).toBe(0);
  });

  it("puts the stock back by default, or keeps it out when the goods are really gone", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const masala = await a.product(store, "Masala", 500, 300);
    await a.adjust(store, masala, 10);
    const onHand = async () => (await a.stock(store)).find((r) => r.productId === masala)!.onHand;

    const back = await a.order(store, { items: [{ productId: masala, quantity: 2 }] });
    await a.status(store, back, "confirmed");
    expect(await onHand()).toBe(8);
    expect((await a.get(store, back)).body.onDelete.stockOut).toBe(true);
    const r1 = await a.del(store, back);
    expect(r1.body.stockPutBack).toBe(true);
    expect(await onHand()).toBe(10);

    const lost = await a.order(store, { items: [{ productId: masala, quantity: 3 }] });
    await a.status(store, lost, "confirmed");
    expect(await onHand()).toBe(7);
    const r2 = await a.del(store, lost, { restoreStock: false });
    expect(r2.body.stockPutBack).toBe(false);
    expect(await onHand()).toBe(7); // the loss stays in the ledger as an adjustment
  });

  it("takes the card link down, and is private to the owner", async () => {
    const x = await newVerifiedOwner(t.app, t.mailer);
    const y = await newVerifiedOwner(t.app, t.mailer);
    const a = api(x.cookie);
    const store = await a.store();
    const order = await a.order(store);
    await a.status(store, order, "confirmed"); // the card link is made
    const token = ((await a.card(store, order)).body.card.url as string).split("/c/")[1];
    expect((await request(t.app).get(`/v1/public/card/${token}`)).status).toBe(200);

    expect((await api(y.cookie).del(store, order)).status).toBe(404);
    expect((await a.get(store, order)).status).toBe(200); // the other owner changed nothing
    expect((await a.del(store, order)).status).toBe(200);
    expect((await request(t.app).get(`/v1/public/card/${token}`)).status).toBe(404); // the customer's link no longer opens
  });
});
