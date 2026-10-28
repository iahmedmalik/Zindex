import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());
const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "patch", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async (name = newId("Store")) => (await call("post", "/v1/stores", { name })).body.store.id as string,
    product: async (store: string, name: string, price: number, cost?: number) =>
      (await call("post", `/v1/stores/${store}/products`, { name, price, ...(cost === undefined ? {} : { cost }) })).body.product.id as string,
    setCost: (store: string, product: string, cost: number) => call("patch", `/v1/stores/${store}/products/${product}`, { cost }),
    order: async (store: string, body: object) => (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", ...body })).body.order.id as string,
    get: async (store: string, order: string) => (await call("get", `/v1/stores/${store}/orders/${order}`)).body.order,
    edit: (store: string, order: string, body: object) => call("patch", `/v1/stores/${store}/orders/${order}`, body),
    sales: async (storeId?: string) => (await call("get", `/v1/reports/sales?from=${today}&to=${today}${storeId ? `&storeId=${storeId}` : ""}`)).body,
    missing: (store: string) => call("get", `/v1/stores/${store}/missing-costs`),
    fill: (store: string, body: object) => call("post", `/v1/stores/${store}/missing-costs/fill`, body),
  };
};

describe("cost per piece", () => {
  it("is saved on each order line when the order is made: from the product, or typed by hand, or unknown", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const masala = await a.product(store, "Masala", 500, 300);
    const noCost = await a.product(store, "Mystery", 800);
    const id = await a.order(store, {
      items: [{ productId: masala, quantity: 2 }, { productId: noCost, quantity: 1 }, { name: "Gift box", quantity: 1, unitPrice: 1000, unitCost: 600 }, { name: "Sticker", quantity: 1, unitPrice: 50 }],
    });
    const items = (await a.get(store, id)).items;
    expect(items.map((i: { name: string; unitCost: number | null }) => [i.name, i.unitCost])).toEqual([["Masala", 300], ["Mystery", null], ["Gift box", 600], ["Sticker", null]]);
  });

  it("is never changed by a later change to the product's cost: only new orders see the new cost", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const masala = await a.product(store, "Masala", 500, 300);
    const before = await a.order(store, { items: [{ productId: masala, quantity: 2 }] });
    const profitBefore = (await a.sales(store)).stores[0].profit;

    expect((await a.setCost(store, masala, 450)).status).toBe(200);
    expect((await a.get(store, before)).items[0].unitCost).toBe(300); // the old sale keeps its cost
    expect((await a.sales(store)).stores[0].profit).toBe(profitBefore); // and its profit
    const after = await a.order(store, { items: [{ productId: masala, quantity: 1 }] });
    expect((await a.get(store, after)).items[0].unitCost).toBe(450); // the new sale takes the new cost
  });

  it("keeps the cost of unchanged lines when a pending order is edited, and uses today's cost for a line added", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const masala = await a.product(store, "Masala", 500, 300);
    const haldi = await a.product(store, "Haldi", 200, 100);
    const id = await a.order(store, { items: [{ productId: masala, quantity: 1 }] });
    await a.setCost(store, masala, 450);
    const edited = await a.edit(store, id, { items: [{ productId: masala, quantity: 3 }, { productId: haldi, quantity: 1 }] });
    expect(edited.status).toBe(200);
    expect(edited.body.order.items.map((i: { name: string; unitCost: number | null }) => [i.name, i.unitCost])).toEqual([["Masala", 300], ["Haldi", 100]]);
  });
});

describe("profit", () => {
  it("counts only the lines that have a cost, shares a discount across the lines, and says what is missing", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store("Food");
    const masala = await a.product(store, "Masala", 500, 300);
    // 2 x 500 (cost 300 each) + 1 typed item of 1,000 with no cost = 2,000; 10% off = 1,800 after discount
    await a.order(store, { discountPercent: 10, riderFee: 300, items: [{ productId: masala, quantity: 2 }, { name: "Gift box", quantity: 1, unitPrice: 1000 }] });
    const s = (await a.sales(store)).stores[0];
    expect(s).toMatchObject({ costOfGoods: 600, linesWithoutCost: 1, salesWithCost: 900, salesWithoutCost: 900, profit: 300, marginPercent: 33.3 });
    expect((await a.sales()).totals).toMatchObject({ profit: 300, salesWithCost: 900, salesWithoutCost: 900 });
  });

  it("leaves out cancelled and returned orders, and keeps each store on its own", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const food = await a.store("Food");
    const shop = await a.store("Shop");
    await a.order(food, { items: [{ name: "A", quantity: 1, unitPrice: 1000, unitCost: 400 }] });
    await a.order(shop, { items: [{ name: "B", quantity: 2, unitPrice: 300, unitCost: 100 }] });
    const gone = await a.order(food, { items: [{ name: "C", quantity: 1, unitPrice: 5000, unitCost: 1000 }] });
    await request(t.app).post(`/v1/stores/${food}/orders/${gone}/status`).set("Cookie", o.cookie).send({ status: "cancelled" });
    const r = await a.sales();
    const byName = Object.fromEntries(r.stores.map((s: { name: string }) => [s.name, s]));
    expect(byName.Food).toMatchObject({ profit: 600, costOfGoods: 400 });
    expect(byName.Shop).toMatchObject({ profit: 400, costOfGoods: 200 });
    expect(r.totals).toMatchObject({ profit: 1000 });
  });
});

describe("costs to fill in", () => {
  it("groups the lines with no cost, fills only those on purpose, and profit follows", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const mystery = await a.product(store, "Mystery", 800); // no cost known when it was sold
    await a.order(store, { items: [{ name: "Gift box", quantity: 1, unitPrice: 1000 }, { productId: mystery, quantity: 1 }] });
    await a.order(store, { items: [{ name: "Gift box", quantity: 2, unitPrice: 1000 }, { name: "Priced", quantity: 1, unitPrice: 100, unitCost: 40 }] });
    await a.setCost(store, mystery, 500); // the product's cost is known now, but the old sale is not changed by it

    const groups = (await a.missing(store)).body.groups;
    expect(groups.map((g: { name: string; lines: number; units: number; sales: number }) => [g.name, g.lines, g.units, g.sales]).sort()).toEqual([["Gift box", 2, 3, 3000], ["Mystery", 1, 1, 800]].sort());
    expect(groups.find((g: { name: string }) => g.name === "Mystery").currentCost).toBe(500); // offered as a suggestion only
    expect((await a.sales(store)).stores[0]).toMatchObject({ linesWithoutCost: 3, profit: 60 }); // only the "Priced" line counts: 100 - 40

    const typed = await a.fill(store, { name: "Gift box", unitCost: 600 });
    expect(typed.body).toEqual({ updated: 2 });
    expect((await a.sales(store)).stores[0]).toMatchObject({ linesWithoutCost: 1, profit: 60 + (3000 - 1800) });
    const product = await a.fill(store, { productId: mystery, unitCost: 500 });
    expect(product.body).toEqual({ updated: 1 });
    expect((await a.missing(store)).body.groups).toEqual([]);
    expect((await a.fill(store, { name: "Gift box", unitCost: 1 })).body).toEqual({ updated: 0 }); // a line that has a cost is never overwritten
  });

  it("is private to the owner, and refuses a bad cost", async () => {
    const x = await newVerifiedOwner(t.app, t.mailer);
    const y = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(x.cookie).store();
    await api(x.cookie).order(store, { items: [{ name: "Gift box", quantity: 1, unitPrice: 1000 }] });
    expect((await api(y.cookie).missing(store)).status).toBe(404);
    expect((await api(y.cookie).fill(store, { name: "Gift box", unitCost: 100 })).status).toBe(404);
    expect((await api(x.cookie).fill(store, { name: "Gift box", unitCost: -5 })).status).toBe(400);
    expect((await api(x.cookie).fill(store, { unitCost: 5 })).status).toBe(400); // say which product or name
    expect((await api(x.cookie).missing(store)).body.groups).toHaveLength(1); // nothing changed
  });
});
