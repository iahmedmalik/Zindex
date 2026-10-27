import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { parseCsv } from "../src/import/csv-parse";
import { mapShopifyOrders } from "../src/import/shopify-orders";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

// A small export in Shopify's column layout: one row per line item, order columns on the first row.
const HEAD = "Name,Email,Financial Status,Paid at,Currency,Subtotal,Shipping,Total,Discount Code,Discount Amount,Created at,Lineitem quantity,Lineitem name,Lineitem price,Billing Name,Billing Phone,Shipping Name,Shipping Address1,Shipping Address2,Shipping City,Shipping Phone,Notes,Cancelled at,Payment Method";
const CSV = [
  HEAD,
  '#1042,ayesha@example.com,paid,2026-10-27 10:00:00 +0500,PKR,9700.00,250.00,9950.00,,0.00,2026-10-27 10:00:00 +0500,1,Oud Royale 50 ml,6500.00,Ayesha Khan,,Ayesha Khan,"House 4, Street 2",,Lahore,+92 300 1234567,"Gift wrap, please",,Easypaisa',
  "#1042,,,,,,,,,,,1,White Musk 30 ml,3200.00,,,,,,,,,,",
  "#1043,bilal@example.com,pending,,PKR,6500.00,250.00,6100.00,WELCOME,650.00,2026-10-27 11:00:00 +0500,1,Oud Royale 50 ml,6500.00,Bilal Ahmed,03217654321,,,,,,,,Cash on Delivery (COD)",
  "#1044,x@example.com,refunded,,PKR,100.00,0,100.00,,0,2026-10-27,1,Thing,100.00,X,,,,,,,,,",
  "#1045,y@example.com,paid,,PKR,100.00,0,100.00,,0,2026-10-27,1,Thing,100.50,Y,,,,,,,,2026-10-27 12:00,",
].join("\r\n");

describe("CSV reading", () => {
  it("handles quotes, commas, doubled quotes and line breaks inside cells", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\n\n1,2,3');
    expect(rows).toEqual([{ a: "x, y", b: 'say "hi"', c: "two\nlines" }, { a: "1", b: "2", c: "3" }]);
  });
  it("refuses a file cut off inside quotes", () => {
    expect(() => parseCsv('a,b\n"open,1')).toThrow(/quoted cell/);
  });
});

describe("Shopify order mapping", () => {
  it("groups line items, maps payment and shipping, and skips cancelled and refunded orders", () => {
    const { orders, skipped, warnings } = mapShopifyOrders(parseCsv(CSV));
    expect(orders.map((o) => o.externalRef)).toEqual(["#1042", "#1043"]);
    expect(orders[0]).toMatchObject({ customerName: "Ayesha Khan", customerPhone: "03001234567", address: "House 4, Street 2, Lahore", payment: "paid", paymentMethod: "Easypaisa", deliveryCharge: 250, notes: "Gift wrap, please" });
    expect(orders[0]!.items).toEqual([{ name: "Oud Royale 50 ml", quantity: 1, unitPrice: 6500 }, { name: "White Musk 30 ml", quantity: 1, unitPrice: 3200 }]);
    expect(orders[1]).toMatchObject({ customerName: "Bilal Ahmed", customerPhone: "03217654321", payment: "cod", discountPercent: 10 });
    expect(skipped).toEqual([{ ref: "#1044", reason: "Shopify says refunded" }, { ref: "#1045", reason: "Cancelled in Shopify" }]);
    expect(warnings).toEqual([]);
  });
  it("flags a discount that is not a whole percent", () => {
    const csv = `${HEAD}\n#2001,,pending,,PKR,1000,0,967,,33,,1,Thing,1000,Z,,,,,,,,,`;
    const { orders, warnings } = mapShopifyOrders(parseCsv(csv));
    expect(orders[0]!.discountPercent).toBe(3);
    expect(warnings[0]!.reason).toMatch(/Shopify total 967 but Zindex works out 970/);
  });
});

describe("importing a Shopify orders file", () => {
  const send = (cookie: string, store: string, body: string) => request(t.app).post(`/v1/stores/${store}/import/shopify-orders`).set("Cookie", cookie).set("Content-Type", "text/csv").send(body);

  it("creates pending orders with draft invoices, matches catalogue products and never imports twice", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const call = (method: "get" | "post", path: string, body?: object) => request(t.app)[method](path).set("Cookie", o.cookie).send(body);
    const store = (await call("post", "/v1/stores", { name: "Sheen Perfumes", invoicePrefix: "SP" })).body.store.id;
    const oud = (await call("post", `/v1/stores/${store}/products`, { name: "Oud Royale 50 ml", price: 6500 })).body.product.id;
    await call("post", `/v1/stores/${store}/stock/adjust`, { productId: oud, delta: 10 });

    const first = await send(o.cookie, store, CSV);
    expect(first.status).toBe(200);
    expect(first.body.imported.map((i: { ref: string }) => i.ref)).toEqual(["#1042", "#1043"]);
    expect(first.body.skipped).toHaveLength(2);

    const orders = (await call("get", `/v1/stores/${store}/orders`)).body.orders;
    expect(orders).toHaveLength(2);
    const ayesha = orders.find((x: { externalRef: string }) => x.externalRef === "#1042");
    expect(ayesha).toMatchObject({ status: "pending", deliveryKind: "courier", payment: "paid", subtotal: 9700, deliveryCharge: 250, total: 9950 });
    expect(ayesha.items[0].productId).toBe(oud);
    expect(ayesha.items[1].productId).toBeNull();
    expect((await call("get", `/v1/stores/${store}/orders/${ayesha.id}/invoice`)).body.invoice).toMatchObject({ status: "draft", number: null });
    expect((await call("get", `/v1/stores/${store}/stock`)).body.stock[0].onHand).toBe(10); // import never touches stock

    const again = await send(o.cookie, store, CSV);
    expect(again.body.imported).toHaveLength(0);
    expect(again.body.alreadyImported).toEqual(["#1042", "#1043"]);
    expect((await call("get", `/v1/stores/${store}/orders`)).body.orders).toHaveLength(2);
  });

  it("refuses an empty or wrong file and another owner's store", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = (await request(t.app).post("/v1/stores").set("Cookie", a.cookie).send({ name: newId("S") })).body.store.id;
    expect((await send(a.cookie, store, "")).status).toBe(400);
    expect((await send(a.cookie, store, "Product,Price\nA,1")).status).toBe(400);
    expect((await send(b.cookie, store, CSV)).status).toBe(404);
  });
});
