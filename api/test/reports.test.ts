import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { toCsv } from "../src/reports/csv";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());
const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

describe("csv", () => {
  it("quotes what needs quoting and defuses spreadsheet formulas", () => {
    const out = toCsv(["Name", "Amount"], [["Khan, Ayesha", 10], ['Say "hi"', null], ["=HYPERLINK(1)", -5]]);
    expect(out.startsWith("﻿Name,Amount\r\n")).toBe(true);
    expect(out).toContain('"Khan, Ayesha",10');
    expect(out).toContain('"Say ""hi""",');
    expect(out).toContain("'=HYPERLINK(1),-5");
  });
});

describe("reports", () => {
  it("adds up sales per store and together, keeping the rider fee out of sales", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const call = (method: "get" | "post" | "put", path: string, body?: object) => request(t.app)[method](path).set("Cookie", o.cookie).send(body);
    const food = (await call("post", "/v1/stores", { name: "Food" })).body.store.id;
    const shop = (await call("post", "/v1/stores", { name: "Shop" })).body.store.id;
    const masala = (await call("post", `/v1/stores/${food}/products`, { name: "Masala", price: 500, cost: 300 })).body.product.id;
    const order = async (store: string, body: object) => (await call("post", `/v1/stores/${store}/orders`, { customerName: "B", ...body })).body.order.id;

    const cod = await order(food, { payment: "cod", riderFee: 300, discountPercent: 10, items: [{ productId: masala, quantity: 2 }] }); // 1000 - 100 = 900
    await call("put", `/v1/stores/${food}/orders/${cod}/delivery`, { riderName: "I" });
    for (const s of ["confirmed", "packed", "out_for_delivery", "delivered"]) await call("post", `/v1/stores/${food}/orders/${cod}/status`, { status: s });
    await call("post", `/v1/stores/${food}/orders/${cod}/payment/cash-handover`);
    const paid = await order(shop, { payment: "paid", deliveryKind: "courier", deliveryCharge: 250, items: [{ name: "Kurta", quantity: 1, unitPrice: 4000 }] }); // 4250
    await call("post", `/v1/stores/${shop}/orders/${paid}/payment/confirm`);
    const cancelled = await order(shop, { items: [{ name: "X", quantity: 1, unitPrice: 999 }] });
    await call("post", `/v1/stores/${shop}/orders/${cancelled}/status`, { status: "cancelled" });

    const r = (await call("get", `/v1/reports/sales?from=${today}&to=${today}`)).body;
    const byName = Object.fromEntries(r.stores.map((s: { name: string }) => [s.name, s]));
    expect(byName.Food).toMatchObject({ orders: 1, gross: 1000, discounts: 100, netSales: 900, codCollected: 900, riderFeesPassedOn: 300, costOfGoods: 600, linesWithoutCost: 0 });
    expect(byName.Shop).toMatchObject({ orders: 1, gross: 4000, deliveryFees: 250, netSales: 4250, onlineReceived: 4250, linesWithoutCost: 1 });
    expect(r.totals).toMatchObject({ orders: 2, netSales: 5150, discounts: 100 });
    expect(r.bestSellers[0]).toMatchObject({ name: "Masala", quantity: 2 });

    const one = (await call("get", `/v1/reports/sales?from=${today}&to=${today}&storeId=${shop}`)).body;
    expect(one.stores).toHaveLength(1);

    const csv = await call("get", `/v1/reports/sales?from=${today}&to=${today}&format=csv`);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain("All stores,2,0,5000,100,250,5150");

    const inv = (await call("get", `/v1/reports/inventory?storeId=${food}`)).body.inventory;
    expect(inv[0]).toMatchObject({ name: "Masala", onHand: -2, unitsSold: 2 });
  });

  it("refuses bad dates and other owners' stores, and needs sign-in", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = (await request(t.app).post("/v1/stores").set("Cookie", a.cookie).send({ name: newId("S") })).body.store.id;
    expect((await request(t.app).get("/v1/reports/sales?from=2026-10-30&to=2026-10-01").set("Cookie", a.cookie)).status).toBe(400);
    expect((await request(t.app).get("/v1/reports/sales?from=yesterday").set("Cookie", a.cookie)).status).toBe(400);
    expect((await request(t.app).get(`/v1/reports/sales?storeId=${store}`).set("Cookie", b.cookie)).status).toBe(404);
    expect((await request(t.app).get(`/v1/reports/inventory?storeId=${store}`).set("Cookie", b.cookie)).body.inventory).toHaveLength(0);
    expect((await request(t.app).get("/v1/reports/sales")).status).toBe(401);
  });
});
