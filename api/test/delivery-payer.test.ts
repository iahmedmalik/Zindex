import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());
const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

// Who pays for delivery: the customer (as always) or the store. When the store pays, the customer's total is goods only,
// the card shows no delivery money, and the fee is the store's cost, which reports take off profit.
async function setup() {
  const owner = await newVerifiedOwner(t.app, t.mailer);
  const call = (method: "get" | "post" | "patch" | "put", path: string, body?: object) => request(t.app)[method](path).set("Cookie", owner.cookie).send(body);
  const store = (await call("post", "/v1/stores", { name: "Shop" })).body.store.id as string;
  const product = (await call("post", `/v1/stores/${store}/products`, { name: "Oud", price: 1000, cost: 600 })).body.product.id as string;
  const make = async (body: object) => (await call("post", `/v1/stores/${store}/orders`, { customerName: "Hira", items: [{ productId: product, quantity: 2 }], ...body })).body.order;
  return { call, store, make };
}

describe("who pays for delivery", () => {
  it("defaults to the customer, exactly as before", async () => {
    const { make } = await setup();
    const o = await make({ payment: "cod", deliveryKind: "local", riderFee: 300 });
    expect(o).toMatchObject({ deliveryPaidBy: "customer", total: 2000, collectAtDoor: 2300 });
  });

  it("rider paid by the store: the customer owes the goods only", async () => {
    const { make } = await setup();
    const cod = await make({ payment: "cod", deliveryKind: "local", riderFee: 300, deliveryPaidBy: "store" });
    expect(cod).toMatchObject({ deliveryPaidBy: "store", riderFee: 300, total: 2000, codAmount: 2000, collectAtDoor: 2000 });
    const paid = await make({ payment: "paid", deliveryKind: "local", riderFee: 300, deliveryPaidBy: "store" });
    expect(paid.collectAtDoor).toBe(0); // prepaid and the store pays the rider: nothing at the door
  });

  it("courier paid by the store: no charge in the total; paid by the customer: it is in the total", async () => {
    const { make } = await setup();
    expect(await make({ payment: "cod", deliveryKind: "courier", deliveryCharge: 250, deliveryPaidBy: "store" })).toMatchObject({ total: 2000, collectAtDoor: 2000, deliveryCharge: 250 });
    expect(await make({ payment: "cod", deliveryKind: "courier", deliveryCharge: 250, deliveryPaidBy: "customer" })).toMatchObject({ total: 2250, collectAtDoor: 2250 });
  });

  it("is ignored on a pickup, which has no delivery", async () => {
    const { make } = await setup();
    expect((await make({ payment: "cod", deliveryKind: "pickup", deliveryPaidBy: "store" })).deliveryPaidBy).toBe("customer");
  });

  it("can be changed on an edit, and the totals follow", async () => {
    const { call, store, make } = await setup();
    const o = await make({ payment: "cod", deliveryKind: "courier", deliveryCharge: 250 });
    expect(o.total).toBe(2250);
    const edited = (await call("patch", `/v1/stores/${store}/orders/${o.id}`, { deliveryPaidBy: "store" })).body.order;
    expect(edited).toMatchObject({ deliveryPaidBy: "store", total: 2000, collectAtDoor: 2000, deliveryCharge: 250 });
    const back = (await call("patch", `/v1/stores/${store}/orders/${o.id}`, { deliveryPaidBy: "customer" })).body.order;
    expect(back.total).toBe(2250);
  });

  it("never shows the customer any delivery money the store pays", async () => {
    const { call, store, make } = await setup();
    const o = await make({ payment: "cod", deliveryKind: "local", riderFee: 300, deliveryPaidBy: "store" });
    await call("post", `/v1/stores/${store}/orders/${o.id}/status`, { status: "confirmed" }); // the card is made on confirm
    const token = (await call("get", `/v1/stores/${store}/orders/${o.id}/card`)).body.card.url.split("/c/")[1] as string;
    const card = (await request(t.app).get(`/v1/public/card/${token}`)).body.card;
    expect(card.order).toMatchObject({ riderFee: 0, deliveryCharge: 0, total: 2000, collectAtDoor: 2000 });

    const normal = await make({ payment: "cod", deliveryKind: "local", riderFee: 300 });
    await call("post", `/v1/stores/${store}/orders/${normal.id}/status`, { status: "confirmed" });
    const t2 = (await call("get", `/v1/stores/${store}/orders/${normal.id}/card`)).body.card.url.split("/c/")[1] as string;
    expect((await request(t.app).get(`/v1/public/card/${t2}`)).body.card.order).toMatchObject({ riderFee: 300, collectAtDoor: 2300 });
  });

  it("reports the store's delivery cost and takes it off profit, and keeps customers' fees out of it", async () => {
    const { call, make } = await setup();
    await make({ payment: "cod", deliveryKind: "local", riderFee: 300 }); // customer pays the rider: passed on
    await make({ payment: "cod", deliveryKind: "local", riderFee: 200, deliveryPaidBy: "store" }); // store pays: cost 200
    await make({ payment: "cod", deliveryKind: "courier", deliveryCharge: 250 }); // customer pays: a delivery fee in sales
    await make({ payment: "cod", deliveryKind: "courier", deliveryCharge: 150, deliveryPaidBy: "store" }); // store pays: cost 150
    const r = (await call("get", `/v1/reports/sales?from=${today}&to=${today}`)).body;
    // goods: 4 orders x 2,000 = 8,000 at cost 4 x 1,200 = 4,800, so goods margin 3,200; the store paid 350 for delivery
    expect(r.totals).toMatchObject({ deliveryFees: 250, riderFeesPassedOn: 300, deliveryPaidByStore: 350, profit: 3200 - 350 });
    expect(r.totals.netSales).toBe(8000 + 250);
    const csv = (await call("get", `/v1/reports/sales?from=${today}&to=${today}&format=csv`)).text;
    expect(csv).toContain("Delivery paid by the store");
  });
});
