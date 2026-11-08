import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

type Money = { orders: number; gross: number; discounts: number; deliveryFees: number; netSales: number; codCollected: number; deliveryPaidByStore: number; costOfGoods: number; salesWithCost: number; salesWithoutCost: number; profit: number; linesWithoutCost: number };
type SalesReport = { stores: (Money & { storeId: string })[]; totals: Money };
const additive = ["orders", "gross", "discounts", "deliveryFees", "netSales", "codCollected", "deliveryPaidByStore", "costOfGoods", "salesWithCost", "salesWithoutCost", "profit", "linesWithoutCost"] as const;
const pick = (m: Money) => Object.fromEntries(additive.map((k) => [k, m[k]]));

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
    pay: (store: string, order: string, amount: number) => call("post", `/v1/stores/${store}/orders/${order}/payments`, { amount, method: "Cash" }),
    sales: async () => (await call("get", "/v1/reports/sales")).body as SalesReport,
    received: async () => (await call("get", "/v1/reports/received")).body as { total: number; byStore: { name: string; amount: number }[] },
    inventory: async () => (await call("get", "/v1/reports/inventory")).body.inventory as { storeName: string; name: string; onHand: number; unitsSold: number; valueAtCost: number | null }[],
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

  it("AUDIT: moving orders changes no money. Combined sales, profit and cash are identical; each store's numbers shift by exactly the moved orders", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const A = await a.store();
    const B = await a.store();
    const oudA = await a.product(A, "Rose Oud", 1000, 600);
    const muskA = await a.product(A, "Musk", 500, 200);
    const oudB = await a.product(B, "Rose Oud", 1200, 700); // same name, other price and other cost
    await a.adjust(A, oudA, 20);
    await a.adjust(A, muskA, 20);
    await a.adjust(B, oudB, 5);

    // A native order in B, so B has its own numbers to keep apart from the moved ones.
    const own = await a.order(B, { items: [{ productId: oudB, quantity: 1 }] });
    await a.status(B, own.id, "confirmed");

    // O1: two products, 10% off the order, courier fee 150 paid by the customer, cash on delivery, delivered and paid.
    const o1 = await a.order(A, { items: [{ productId: oudA, quantity: 2 }, { productId: muskA, quantity: 1 }], discountPercent: 10, deliveryKind: "courier", deliveryCharge: 150, payment: "cod" });
    for (const st of ["confirmed", "packed", "out_for_delivery", "delivered"]) await a.status(A, o1.id, st);
    const o1Unpaid = (await a.get(A, o1.id)).body.order;
    expect((await a.pay(A, o1.id, o1Unpaid.expected)).status).toBe(201);
    const o1Before = (await a.get(A, o1.id)).body.order; // after the payment, so "paid" is part of what must not change
    // O2: an item discount of 100 off the line, a rider fee of 300 that the store pays, confirmed.
    const o2 = await a.order(A, { items: [{ productId: oudA, quantity: 1, discount: { kind: "amount", value: 100 } }], deliveryKind: "local", riderFee: 300, deliveryPaidBy: "store" });
    await a.status(A, o2.id, "confirmed");
    // O3: a typed item with no cost (unknown), still pending.
    const o3 = await a.order(A, { items: [{ name: "Gift box", quantity: 1, unitPrice: 800 }] });

    // Hand-worked numbers for O1 (not read back from the system): goods 2x1000 + 500 = 2500, 10% off = 250, + 150 courier = 2400.
    expect(o1Before).toMatchObject({ subtotal: 2500, discount: 250, total: 2400, codAmount: 2400 });

    const before = { sales: await a.sales(), received: await a.received(), inv: await a.inventory(), o2: (await a.get(A, o2.id)).body.order, o3: (await a.get(A, o3.id)).body.order };
    const storeBefore = (r: SalesReport, id: string) => r.stores.find((x) => x.storeId === id)!;
    expect(storeBefore(before.sales, A).orders).toBe(3);

    for (const id of [o1.id, o2.id, o3.id]) expect((await a.edit(A, id, { storeId: B })).status).toBe(200);

    const after = { sales: await a.sales(), received: await a.received(), inv: await a.inventory() };

    // 1. The business as a whole: every sales, discount, delivery, cost, profit and cash figure is the same.
    expect(pick(after.sales.totals)).toEqual(pick(before.sales.totals));
    expect(after.received.total).toBe(before.received.total);

    // 2. Store A is empty of these orders; store B now holds its own numbers plus exactly the moved ones.
    expect(pick(storeBefore(after.sales, A))).toEqual(Object.fromEntries(additive.map((k) => [k, 0])));
    for (const k of additive) expect(storeBefore(after.sales, B)[k]).toBe(storeBefore(before.sales, A)[k] + storeBefore(before.sales, B)[k]);
    expect(before.received.total).toBe(2400);
    expect(after.received.byStore).toHaveLength(1); // all the cash received now sits under B (it was all under A before)
    expect(after.received.byStore[0]!.amount).toBe(2400);

    // 3. Each moved order keeps every amount it had.
    const o1After = (await a.get(B, o1.id)).body.order;
    for (const k of ["subtotal", "discount", "total", "codAmount", "collectAtDoor", "amountDue", "paid", "expected"] as const) expect(o1After[k]).toBe(o1Before[k]);
    const o2After = (await a.get(B, o2.id)).body.order;
    const o3After = (await a.get(B, o3.id)).body.order;
    for (const k of ["subtotal", "discount", "total", "codAmount", "amountDue"] as const) {
      expect(o2After[k]).toBe(before.o2[k]);
      expect(o3After[k]).toBe(before.o3[k]);
    }

    // 4. The cost saved on each line is kept: B's Rose Oud costs 700 today, but the moved sales still cost 600 (profit does not move).
    expect(o1After.items.map((i: { unitCost: number | null }) => i.unitCost)).toEqual([600, 200]);

    // 5. Stock: Rose Oud is sold from B now, and the total on hand across both stores is what it was.
    const oud = (rows: typeof before.inv) => rows.filter((r) => r.name === "Rose Oud");
    const total = (rows: typeof before.inv, k: "onHand" | "unitsSold") => oud(rows).reduce((n, r) => n + r[k], 0);
    expect(total(after.inv, "onHand")).toBe(total(before.inv, "onHand"));
    expect(total(after.inv, "unitsSold")).toBe(total(before.inv, "unitsSold"));
    // By hand: A had 20 and is back to 20 (its 3 sold units returned); B had 5, sold 1 of its own and now 3 more = 1 left.
    expect(oud(after.inv).map((r) => r.onHand).sort((x, y) => x - y)).toEqual([1, 20]);
    expect(oud(after.inv).map((r) => r.unitsSold).sort((x, y) => x - y)).toEqual([0, 4]);
    expect(oud(before.inv).map((r) => r.onHand).sort((x, y) => x - y)).toEqual([4, 17]);
    // Musk exists only in A, so on B the line is a typed item with no stock: A gets the unit back and nothing is taken from B.
    const musk = after.inv.find((r) => r.name === "Musk")!;
    expect(musk.onHand).toBe(20);
    expect(musk.unitsSold).toBe(0);
  });
});
