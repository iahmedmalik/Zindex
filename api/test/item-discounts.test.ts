import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());
const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "patch", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async () => (await call("post", "/v1/stores", { name: newId("Store"), invoicePrefix: "SF" })).body.store.id as string,
    product: async (store: string, name: string, price: number, cost?: number) =>
      (await call("post", `/v1/stores/${store}/products`, { name, price, ...(cost === undefined ? {} : { cost }) })).body.product.id as string,
    create: (store: string, body: object) => call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", ...body }),
    get: async (store: string, order: string) => (await call("get", `/v1/stores/${store}/orders/${order}`)).body.order,
    edit: (store: string, order: string, body: object) => call("patch", `/v1/stores/${store}/orders/${order}`, body),
    sales: async (storeId: string) => (await call("get", `/v1/reports/sales?from=${today}&to=${today}&storeId=${storeId}`)).body,
  };
};

describe("a discount on one item", () => {
  it("is saved on the line, in rupees or percent, and the order's totals follow it", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const made = await a.create(store, {
      items: [
        { name: "Rose Oud", quantity: 2, unitPrice: 4500, discount: { kind: "percent", value: 10 } },
        { name: "Musk Attar", quantity: 2, unitPrice: 1800, discount: { kind: "amount", value: 360 } },
        { name: "Gift box", quantity: 1, unitPrice: 250 },
      ],
      discountPercent: 5,
      deliveryCharge: 200,
    });
    expect(made.status).toBe(201);
    const order = made.body.order;
    expect(order.items.map((i: { discountKind: string | null; discountValue: number | null; discountAmount: number; unitPrice: number }) => [i.discountKind, i.discountValue, i.discountAmount, i.unitPrice])).toEqual([
      ["percent", 10, 900, 4500],
      ["amount", 360, 360, 1800],
      [null, null, 0, 250],
    ]);
    // lines: 8100 + 3240 + 250 = 11590; order discount 5% = 580 (579.5 up); delivery 200
    expect(order).toMatchObject({ subtotal: 11590, discount: 580, total: 11210 });
  });

  it("a discount of 0 is the same as none; a rupee discount larger than the line, or a percent over 100, is refused", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const zero = await a.create(store, { items: [{ name: "Spice", quantity: 1, unitPrice: 1000, discount: { kind: "percent", value: 0 } }] });
    expect(zero.body.order.items[0]).toMatchObject({ discountKind: null, discountValue: null, discountAmount: 0 });
    const tooMuch = await a.create(store, { items: [{ name: "Spice", quantity: 1, unitPrice: 1000, discount: { kind: "amount", value: 1001 } }] });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatch(/Spice: .*more than the item's total/);
    expect((await a.create(store, { items: [{ name: "Spice", quantity: 1, unitPrice: 1000, discount: { kind: "percent", value: 101 } }] })).status).toBe(400);
    expect((await a.create(store, { items: [{ name: "Spice", quantity: 1, unitPrice: 1000, discount: { kind: "percent", value: 5.5 } }] })).status).toBe(400);
  });

  it("can be changed or removed when the order is edited, and the order's totals are worked out again", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const id = (await a.create(store, { items: [{ name: "Rose Oud", quantity: 1, unitPrice: 4000, discount: { kind: "percent", value: 10 } }] })).body.order.id as string;
    expect((await a.get(store, id)).total).toBe(3600);

    expect((await a.edit(store, id, { items: [{ name: "Rose Oud", quantity: 1, unitPrice: 4000, discount: { kind: "amount", value: 500 } }] })).status).toBe(200);
    expect(await a.get(store, id)).toMatchObject({ total: 3500, items: [{ discountKind: "amount", discountValue: 500, discountAmount: 500 }] });

    await a.edit(store, id, { items: [{ name: "Rose Oud", quantity: 1, unitPrice: 4000 }] });
    expect(await a.get(store, id)).toMatchObject({ total: 4000, items: [{ discountKind: null, discountAmount: 0 }] });

    // changing only the delivery keeps the item discounts the order already has
    await a.edit(store, id, { items: [{ name: "Rose Oud", quantity: 2, unitPrice: 4000, discount: { kind: "percent", value: 25 } }] });
    await a.edit(store, id, { deliveryCharge: 300 });
    expect(await a.get(store, id)).toMatchObject({ subtotal: 6000, total: 6300, items: [{ discountKind: "percent", discountValue: 25, discountAmount: 2000 }] });
  });

  it("reports count the discounted price: sales, profit and the discount total are all after the item discount", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const oud = await a.product(store, "Rose Oud", 1000, 600);
    await a.create(store, { items: [{ productId: oud, quantity: 2, discount: { kind: "amount", value: 200 } }] }); // sold for 1800, cost 1200
    const report = await a.sales(store);
    const s = report.stores[0];
    expect(s).toMatchObject({ gross: 2000, discounts: 200, netSales: 1800, costOfGoods: 1200, profit: 600 });
  });
});
