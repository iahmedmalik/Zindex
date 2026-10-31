import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

// A pickup order keeps the same stored statuses (out_for_delivery = "Ready for pickup", delivered = "Picked up"),
// can carry a Google Maps link for the customer's card, and the lists keep pickup apart from delivery.
async function setup() {
  const owner = await newVerifiedOwner(t.app, t.mailer);
  const call = (method: "get" | "post" | "patch", path: string, body?: object) => request(t.app)[method](path).set("Cookie", owner.cookie).send(body);
  const store = (await call("post", "/v1/stores", { name: "Shop", address: "Shop 3, Main Market" })).body.store.id as string;
  const make = async (body: object) => (await call("post", `/v1/stores/${store}/orders`, { customerName: "Hira", items: [{ name: "Oud", quantity: 1, unitPrice: 1800 }], payment: "cod", ...body })).body.order;
  const move = (id: string, status: string) => call("post", `/v1/stores/${store}/orders/${id}/status`, { status });
  return { call, store, make, move };
}
const MAP = "https://maps.app.goo.gl/Xk3pQ2mV9a";

describe("the map link on a pickup order", () => {
  it("is saved on a pickup order, shown to the customer on the card, and can be changed or removed", async () => {
    const { call, store, make, move } = await setup();
    const o = await make({ deliveryKind: "pickup", pickupMapUrl: MAP });
    expect(o.pickupMapUrl).toBe(MAP);
    await move(o.id, "confirmed"); // the card is made on confirm
    const token = (await call("get", `/v1/stores/${store}/orders/${o.id}/card`)).body.card.url.split("/c/")[1] as string;
    expect((await request(t.app).get(`/v1/public/card/${token}`)).body.card.order).toMatchObject({ deliveryKind: "pickup", pickupMapUrl: MAP });

    const changed = (await call("patch", `/v1/stores/${store}/orders/${o.id}`, { pickupMapUrl: "https://www.google.com/maps/place/Shop" })).body.order;
    expect(changed.pickupMapUrl).toBe("https://www.google.com/maps/place/Shop");
    expect((await call("patch", `/v1/stores/${store}/orders/${o.id}`, { pickupMapUrl: null })).body.order.pickupMapUrl).toBeNull();
    expect((await call("patch", `/v1/stores/${store}/orders/${o.id}`, { customerName: "Hira B" })).body.order.pickupMapUrl).toBeNull(); // other edits leave it alone
  });

  it("must be an https link", async () => {
    const { call, store } = await setup();
    const res = await call("post", `/v1/stores/${store}/orders`, { customerName: "Hira", deliveryKind: "pickup", pickupMapUrl: "http://maps.example/x", items: [{ name: "Oud", quantity: 1, unitPrice: 100 }] });
    expect(res.status).toBe(400);
  });

  it("is dropped when the order is not a pickup, and kept when edited back", async () => {
    const { call, store, make } = await setup();
    expect((await make({ deliveryKind: "local", pickupMapUrl: MAP })).pickupMapUrl).toBeNull();
    const o = await make({ deliveryKind: "pickup", pickupMapUrl: MAP });
    expect((await call("patch", `/v1/stores/${store}/orders/${o.id}`, { deliveryKind: "courier" })).body.order.pickupMapUrl).toBeNull();
  });
});

describe("pickup apart from delivery", () => {
  it("the orders list can show pickup only or leave it out, for the same stored status", async () => {
    const { call, store, make, move } = await setup();
    const delivery = await make({ deliveryKind: "local" });
    const pickup = await make({ deliveryKind: "pickup" });
    for (const o of [delivery, pickup]) for (const s of ["confirmed", "packed", "out_for_delivery"]) await move(o.id, s);
    const ids = async (qs: string) => ((await call("get", `/v1/stores/${store}/orders?status=out_for_delivery${qs}`)).body.orders as { id: string }[]).map((o) => o.id);
    expect(await ids("")).toEqual(expect.arrayContaining([delivery.id, pickup.id]));
    expect(await ids("&pickup=1")).toEqual([pickup.id]);
    expect(await ids("&pickup=0")).toEqual([delivery.id]);
  });

  it("Today counts a ready pickup apart from an order on its way", async () => {
    const { call, store, make, move } = await setup();
    const delivery = await make({ deliveryKind: "local" });
    const pickup = await make({ deliveryKind: "pickup" });
    for (const o of [delivery, pickup]) for (const s of ["confirmed", "packed", "out_for_delivery"]) await move(o.id, s);
    const mine = (await call("get", "/v1/dashboard")).body.stores.find((s: { storeId: string }) => s.storeId === store);
    expect(mine).toMatchObject({ outForDelivery: 1, readyForPickup: 1 });
  });

  it("has its own 'ready for pickup' message, filled from the order", async () => {
    const { call, store, make } = await setup();
    const o = await make({ deliveryKind: "pickup" });
    const msg = (await call("get", `/v1/stores/${store}/orders/${o.id}/whatsapp?template=ready_for_pickup&link=https%3A%2F%2Fx.example%2Fc%2Fabc`)).body;
    expect(msg.text).toMatch(/ready for pickup/);
    expect(msg.text).toContain("1,800");
    expect(msg.text).toContain("https://x.example/c/abc");
  });
});
