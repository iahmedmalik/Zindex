import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "patch", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async (name = newId("Store"), invoicePrefix = "SF") => (await call("post", "/v1/stores", { name, invoicePrefix })).body.store.id as string,
    order: async (store: string, body: object = {}) =>
      (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", customerPhone: "03001234567", items: [{ name: "Spice", quantity: 2, unitPrice: 500 }], ...body })).body.order.id as string,
    draft: (store: string, order: string) => call("post", `/v1/stores/${store}/orders/${order}/invoice`),
    finalise: (store: string, order: string) => call("post", `/v1/stores/${store}/orders/${order}/invoice/finalise`),
    get: (store: string, order: string) => call("get", `/v1/stores/${store}/orders/${order}/invoice`),
    edit: (store: string, order: string, body: object) => call("patch", `/v1/stores/${store}/orders/${order}`, body),
    status: (store: string, order: string, status: string) => call("post", `/v1/stores/${store}/orders/${order}/status`, { status }),
    list: (store: string, q = "") => call("get", `/v1/stores/${store}/invoices?q=${encodeURIComponent(q)}`),
  };
};

describe("invoices", () => {
  it("makes a draft with no number, then a final with the store's next number", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    const draft = await a.draft(store, order);
    expect(draft.status).toBe(201);
    expect(draft.body.invoice).toMatchObject({ status: "draft", number: null });
    expect(draft.body.store).toMatchObject({ accent: "#5d1b23" });
    expect(draft.body.store).toHaveProperty("email"); // shown on the invoice header
    expect(draft.body.order).toMatchObject({ total: 1000 });

    const final = await a.finalise(store, order);
    expect(final.body.invoice).toMatchObject({ status: "final", number: "SF-0001" });
    expect(final.body.invoice.finalisedAt).toBeTruthy();
  });

  it("never makes a second invoice or a second number for the same order", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    const first = await a.draft(store, order);
    const again = await a.draft(store, order);
    expect(again.status).toBe(200);
    expect(again.body.invoice.id).toBe(first.body.invoice.id);
    await a.finalise(store, order);
    expect((await a.finalise(store, order)).body.invoice.number).toBe("SF-0001");
    const second = await a.order(store);
    await a.draft(store, second);
    expect((await a.finalise(store, second)).body.invoice.number).toBe("SF-0002");
  });

  it("numbers each store on its own", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const food = await a.store("Food", "SF");
    const shop = await a.store("Shop", "TS");
    for (const [store, expected] of [[food, "SF-0001"], [shop, "TS-0001"], [food, "SF-0002"]] as const) {
      const order = await a.order(store);
      await a.draft(store, order);
      expect((await a.finalise(store, order)).body.invoice.number).toBe(expected);
    }
  });

  it("logs every change made to an order after its invoice is final", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    await a.draft(store, order);
    await a.edit(store, order, { notes: "edited while draft" }); // not logged: still a draft
    expect((await a.get(store, order)).body.edits).toHaveLength(0);

    await a.finalise(store, order);
    await a.edit(store, order, { discountPercent: 10, address: "New address" });
    await a.edit(store, order, { notes: "same again" });
    await a.edit(store, order, { notes: "same again" }); // nothing changed: not logged
    const edits = (await a.get(store, order)).body.edits;
    expect(edits).toHaveLength(2);
    expect(edits[0].changed.sort()).toEqual(["address", "discountPercent", "total"]);
    expect(edits[0].before.total).toBe(1000);
    expect(edits[0].after.total).toBe(900);
    expect(edits[1].changed).toEqual(["notes"]);
  });

  it("is searchable by number, customer and phone", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const one = await a.order(store, { customerName: "Hira Malik", customerPhone: "03005550001" });
    const two = await a.order(store, { customerName: "Omar", customerPhone: "03005550002" });
    for (const id of [one, two]) {
      await a.draft(store, id);
      await a.finalise(store, id);
    }
    expect((await a.list(store)).body.invoices).toHaveLength(2);
    expect((await a.list(store, "SF-0002")).body.invoices[0].customerName).toBe("Omar");
    expect((await a.list(store, "hira")).body.invoices).toHaveLength(1);
    expect((await a.list(store, "+92 300 5550002")).body.invoices[0].customerName).toBe("Omar");
  });

  it("refuses a cancelled order and another owner's invoice", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(a.cookie).store();
    const cancelled = await api(a.cookie).order(store);
    await api(a.cookie).status(store, cancelled, "cancelled");
    expect((await api(a.cookie).draft(store, cancelled)).status).toBe(409);

    const order = await api(a.cookie).order(store);
    await api(a.cookie).draft(store, order);
    expect((await api(b.cookie).get(store, order)).status).toBe(404);
    expect((await api(b.cookie).draft(store, order)).status).toBe(404);
    expect((await api(b.cookie).finalise(store, order)).status).toBe(404);
    expect((await api(b.cookie).list(store)).body.invoices).toHaveLength(0);
    expect((await api(a.cookie).finalise(store, "not-an-id")).status).toBe(404);
  });
});
