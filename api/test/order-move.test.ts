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
    order: async (store: string, body: object) => (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", customerPhone: "03001234567", ...body })).body.order as { id: string; orderNo: number },
    get: (store: string, order: string) => call("get", `/v1/stores/${store}/orders/${order}`),
    list: async (store: string) => (await call("get", `/v1/stores/${store}/orders`)).body.orders as { id: string }[],
    edit: (store: string, order: string, body: object) => call("patch", `/v1/stores/${store}/orders/${order}`, body),
    status: (store: string, order: string, status: string) => call("post", `/v1/stores/${store}/orders/${order}/status`, { status }),
    restore: (store: string, order: string) => call("post", `/v1/stores/${store}/orders/${order}/restore-stock`),
    invoice: async (store: string, order: string) => (await call("get", `/v1/stores/${store}/orders/${order}/invoice`)).body,
    customers: async (store: string) => (await call("get", `/v1/stores/${store}/customers`)).body.customers as { phone: string | null }[],
  };
};

describe("moving an order to another store", () => {
  it("a new order gets the next order and invoice number there, items match by name, and the old store gets its invoice number back", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const from = await a.store();
    const to = await a.store();
    const oudFrom = await a.product(from, "Rose Oud", 1000, 600);
    const oudTo = await a.product(to, "rose oud", 1200, 700); // same name, different case and price
    await a.order(to, { items: [{ name: "Other", quantity: 1, unitPrice: 100 }] }); // order 1 of the other store
    const order = await a.order(from, { items: [{ productId: oudFrom, quantity: 2 }, { name: "Gift box", quantity: 1, unitPrice: 100 }] });
    const invoiceBefore = (await a.invoice(from, order.id)).invoice.number as string;

    const moved = await a.edit(from, order.id, { storeId: to });
    expect(moved.status).toBe(200);
    expect(moved.body.order).toMatchObject({ id: order.id, storeId: to, orderNo: 2, subtotal: 2100, total: 2100 });
    expect(moved.body.order.items.map((i: { productId: string | null; name: string; unitPrice: number }) => [i.productId, i.name, i.unitPrice])).toEqual([[oudTo, "Rose Oud", 1000], [null, "Gift box", 100]]); // the order keeps the price it was sold at

    expect((await a.get(from, order.id)).status).toBe(404); // no longer in the old store
    expect(await a.list(from)).toEqual([]);
    expect((await a.list(to)).map((x) => x.id)).toContain(order.id);
    const invoiceAfter = await a.invoice(to, order.id);
    expect(invoiceAfter.invoice.storeId).toBe(to);
    expect(invoiceAfter.invoice.number).not.toBe(invoiceBefore); // the number is that store's next one
    expect((await a.customers(to)).map((c) => c.phone)).toContain("03001234567");

    // the old store's invoice number was the latest, so it is given back: the next order there reuses it
    const next = await a.order(from, { items: [{ name: "Spice", quantity: 1, unitPrice: 50 }] });
    expect((await a.invoice(from, next.id)).invoice.number).toBe(invoiceBefore);
  });

  it("a confirmed order's stock goes back in the old store and comes out of the new one; cancelling later restores only the new store", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const from = await a.store();
    const to = await a.store();
    const oudFrom = await a.product(from, "Rose Oud", 1000, 600);
    const oudTo = await a.product(to, "Rose Oud", 1000, 600);
    await a.adjust(from, oudFrom, 10);
    await a.adjust(to, oudTo, 10);
    const order = await a.order(from, { items: [{ productId: oudFrom, quantity: 3 }] });
    await a.status(from, order.id, "confirmed");
    expect([await a.onHand(from, oudFrom), await a.onHand(to, oudTo)]).toEqual([7, 10]);

    const moved = await a.edit(from, order.id, { storeId: to });
    expect(moved.status).toBe(200);
    expect(moved.body.order).toMatchObject({ storeId: to, status: "confirmed", stockApplied: true });
    expect([await a.onHand(from, oudFrom), await a.onHand(to, oudTo)]).toEqual([10, 7]);

    await a.status(to, order.id, "cancelled");
    expect((await a.restore(to, order.id)).status).toBe(200);
    expect([await a.onHand(from, oudFrom), await a.onHand(to, oudTo)]).toEqual([10, 10]);
  });

  it("warns when the new store does not have enough stock", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const from = await a.store();
    const to = await a.store();
    const oudFrom = await a.product(from, "Rose Oud", 1000);
    await a.product(to, "Rose Oud", 1000);
    await a.adjust(from, oudFrom, 5);
    const order = await a.order(from, { items: [{ productId: oudFrom, quantity: 2 }] });
    await a.status(from, order.id, "confirmed");
    const moved = await a.edit(from, order.id, { storeId: to });
    expect(moved.status).toBe(200);
    expect(moved.body.stockWarnings).toHaveLength(1);
  });

  it("works after delivery, and writes the move on the invoice's edit log", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const from = await a.store();
    const to = await a.store();
    const order = await a.order(from, { items: [{ name: "Spice", quantity: 1, unitPrice: 1000 }] });
    for (const s of ["confirmed", "packed", "out_for_delivery", "delivered"]) await a.status(from, order.id, s);

    const moved = await a.edit(from, order.id, { storeId: to, notes: "moved" });
    expect(moved.status).toBe(200);
    expect(moved.body.order).toMatchObject({ storeId: to, status: "delivered" });
    const after = await a.invoice(to, order.id);
    expect(after.edits).toHaveLength(1);
    expect(after.edits[0].changed).toEqual(expect.arrayContaining(["storeId", "notes"])); // order no. stays 1: the new store was empty
  });

  it("refuses another owner's store, a cancelled order, and keeps the order where it was on any failure", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const other = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const from = await a.store();
    const theirs = await api(other.cookie).store();
    const order = await a.order(from, { items: [{ name: "Spice", quantity: 1, unitPrice: 1000 }] });

    const stranger = await a.edit(from, order.id, { storeId: theirs });
    expect(stranger.status).toBe(404);
    expect((await a.get(from, order.id)).body.order.storeId).toBe(from);

    const to = await a.store();
    await a.status(from, order.id, "cancelled");
    expect((await a.edit(from, order.id, { storeId: to })).status).toBe(409);
  });

  it("a PATCH with the order's own store changes nothing about numbering", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const from = await a.store();
    const order = await a.order(from, { items: [{ name: "Spice", quantity: 1, unitPrice: 1000 }] });
    const same = await a.edit(from, order.id, { storeId: from, notes: "x" });
    expect(same.status).toBe(200);
    expect(same.body.order).toMatchObject({ storeId: from, orderNo: order.orderNo });
  });
});
