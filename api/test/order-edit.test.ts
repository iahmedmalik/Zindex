import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "patch", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async () => (await call("post", "/v1/stores", { name: newId("Store"), invoicePrefix: "SF" })).body.store.id as string,
    product: async (store: string, name: string, price: number, cost?: number) =>
      (await call("post", `/v1/stores/${store}/products`, { name, price, ...(cost === undefined ? {} : { cost }) })).body.product.id as string,
    adjust: (store: string, productId: string, delta: number) => call("post", `/v1/stores/${store}/stock/adjust`, { productId, delta }),
    onHand: async (store: string, productId: string) => ((await call("get", `/v1/stores/${store}/stock`)).body.stock as { productId: string; onHand: number }[]).find((r) => r.productId === productId)!.onHand,
    order: async (store: string, body: object) => (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", ...body })).body.order as { id: string },
    get: async (store: string, order: string) => (await call("get", `/v1/stores/${store}/orders/${order}`)).body.order,
    edit: (store: string, order: string, body: object) => call("patch", `/v1/stores/${store}/orders/${order}`, body),
    status: (store: string, order: string, status: string) => call("post", `/v1/stores/${store}/orders/${order}/status`, { status }),
    restore: (store: string, order: string) => call("post", `/v1/stores/${store}/orders/${order}/restore-stock`),
    invoice: async (store: string, order: string) => (await call("get", `/v1/stores/${store}/orders/${order}/invoice`)).body,
    history: async (store: string, productId: string) => (await call("get", `/v1/stores/${store}/stock/${productId}/history`)).body,
  };
};

describe("editing an order at any stage", () => {
  it("a confirmed order's items can change: the stock moves by the difference, and a later cancel puts back the net amount", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const oud = await a.product(store, "Rose Oud", 1000, 600);
    const musk = await a.product(store, "Musk", 500, 200);
    await a.adjust(store, oud, 10);
    await a.adjust(store, musk, 10);
    const order = await a.order(store, { items: [{ productId: oud, quantity: 2 }, { productId: musk, quantity: 1 }] });
    await a.status(store, order.id, "confirmed");
    expect([await a.onHand(store, oud), await a.onHand(store, musk)]).toEqual([8, 9]);

    // Rose Oud 2 -> 5, Musk removed, a typed item added
    const edited = await a.edit(store, order.id, { items: [{ productId: oud, quantity: 5 }, { name: "Gift box", quantity: 1, unitPrice: 100 }] });
    expect(edited.status).toBe(200);
    expect(edited.body.order).toMatchObject({ status: "confirmed", subtotal: 5100, total: 5100 });
    expect([await a.onHand(store, oud), await a.onHand(store, musk)]).toEqual([5, 10]);

    expect((await a.history(store, oud)).history.map((h: { reason: string; delta: number }) => [h.reason, h.delta])).toContainEqual(["edit", -3]);

    await a.status(store, order.id, "cancelled");
    expect((await a.restore(store, order.id)).status).toBe(200);
    expect([await a.onHand(store, oud), await a.onHand(store, musk)]).toEqual([10, 10]); // everything is back, not just the first sale
    expect((await a.edit(store, order.id, { notes: "x" })).status).toBe(409); // cancelled: no more edits
  });

  it("works after delivery, keeps the status and the invoice number, and logs the change on the invoice", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store, { items: [{ name: "Spice", quantity: 1, unitPrice: 1000 }] });
    for (const s of ["confirmed", "packed", "out_for_delivery", "delivered"]) await a.status(store, order.id, s);
    const before = await a.invoice(store, order.id);

    const edited = await a.edit(store, order.id, { customerName: "Ayesha Khan", items: [{ name: "Spice", quantity: 2, unitPrice: 900 }], deliveryCharge: 100, payment: "paid" });
    expect(edited.status).toBe(200);
    expect(edited.body.order).toMatchObject({ status: "delivered", customerName: "Ayesha Khan", total: 1900, payment: "paid" });

    const after = await a.invoice(store, order.id);
    expect(after.invoice.number).toBe(before.invoice.number);
    expect(after.order.total).toBe(1900);
    expect(after.edits).toHaveLength(1);
    expect(after.edits[0].changed).toEqual(expect.arrayContaining(["customerName", "items", "total"]));
  });

  it("refuses a returned order, and a discount that no longer fits the changed item", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store, { items: [{ name: "Spice", quantity: 1, unitPrice: 1000, discount: { kind: "amount", value: 900 } }] });
    const tooMuch = await a.edit(store, order.id, { items: [{ name: "Spice", quantity: 1, unitPrice: 500, discount: { kind: "amount", value: 900 } }] });
    expect(tooMuch.status).toBe(400);
    for (const s of ["confirmed", "packed", "out_for_delivery", "returned"]) await a.status(store, order.id, s);
    expect((await a.edit(store, order.id, { notes: "x" })).status).toBe(409);
  });
});
