import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, connect, newId, newVerifiedOwner, urls } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "patch", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async (name = newId("Store"), invoicePrefix = "SF") => (await call("post", "/v1/stores", { name, invoicePrefix })).body.store.id as string,
    order: async (store: string, body: object = {}) =>
      (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", customerPhone: "03001234567", items: [{ name: "Spice", quantity: 2, unitPrice: 500 }], ...body })).body.order.id as string,
    post: (store: string, order: string, path = "") => call("post", `/v1/stores/${store}/orders/${order}/invoice${path}`),
    get: (store: string, order: string) => call("get", `/v1/stores/${store}/orders/${order}/invoice`),
    edit: (store: string, order: string, body: object) => call("patch", `/v1/stores/${store}/orders/${order}`, body),
    status: (store: string, order: string, status: string) => call("post", `/v1/stores/${store}/orders/${order}/status`, { status }),
    list: (store: string, q = "") => call("get", `/v1/stores/${store}/invoices?q=${encodeURIComponent(q)}`),
  };
};

describe("invoices", () => {
  it("makes the invoice with the store's next number the moment the order is created", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    const found = await a.get(store, order); // nothing was asked for: no "make" and no "finalise" step
    expect(found.status).toBe(200);
    expect(found.body.invoice).toMatchObject({ status: "final", number: "SF-0001" });
    expect(found.body.invoice.finalisedAt).toBeTruthy();
    expect(found.body.store).toMatchObject({ accent: "#5d1b23" });
    expect(found.body.store).toHaveProperty("email"); // shown on the invoice header
    expect(found.body.order).toMatchObject({ total: 1000 });
    expect((await a.post(store, order)).status).toBe(404); // the old make and finalise steps are gone
    expect((await a.post(store, order, "/finalise")).status).toBe(404);
  });

  it("never makes a second invoice or a second number for the same order", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const key = newId("retry");
    const body = { customerName: "Ayesha", items: [{ name: "Spice", quantity: 1, unitPrice: 500 }], idempotencyKey: key };
    const first = (await request(t.app).post(`/v1/stores/${store}/orders`).set("Cookie", o.cookie).send(body)).body.order.id as string;
    const retried = await request(t.app).post(`/v1/stores/${store}/orders`).set("Cookie", o.cookie).send(body); // a retried request
    expect(retried.body.order.id).toBe(first);
    expect((await a.get(store, first)).body.invoice.number).toBe("SF-0001");
    expect((await a.get(store, first)).body.invoice.number).toBe("SF-0001"); // opening it again changes nothing
    expect((await a.get(store, await a.order(store))).body.invoice.number).toBe("SF-0002"); // the retry did not use up a number
  });

  it("numbers each store on its own", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const food = await a.store("Food", "SF");
    const shop = await a.store("Shop", "TS");
    for (const [store, expected] of [[food, "SF-0001"], [shop, "TS-0001"], [food, "SF-0002"]] as const) {
      const order = await a.order(store);
      expect((await a.get(store, order)).body.invoice.number).toBe(expected);
    }
  });

  it("writes changes to the edit log only once the order is out for delivery or later", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    await a.edit(store, order, { notes: "typo fixed right after creating" }); // the invoice just follows the order
    expect((await a.get(store, order)).body.edits).toHaveLength(0);
    for (const s of ["confirmed", "packed"]) await a.status(store, order, s);
    await a.edit(store, order, { notes: "still before it leaves" });
    expect((await a.get(store, order)).body.edits).toHaveLength(0);

    await a.status(store, order, "out_for_delivery");
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

  it("keeps a cancelled order's invoice and number, and never reuses the number", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const cancelled = await a.order(store);
    await a.status(store, cancelled, "cancelled");
    const kept = await a.get(store, cancelled);
    expect(kept.status).toBe(200);
    expect(kept.body.invoice.number).toBe("SF-0001");
    expect(kept.body.order.status).toBe("cancelled");
    expect((await a.get(store, await a.order(store))).body.invoice.number).toBe("SF-0002");
  });

  it("is searchable by number, customer and phone", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    await a.order(store, { customerName: "Hira Malik", customerPhone: "03005550001" });
    await a.order(store, { customerName: "Omar", customerPhone: "03005550002" });
    expect((await a.list(store)).body.invoices).toHaveLength(2);
    expect((await a.list(store, "SF-0002")).body.invoices[0].customerName).toBe("Omar");
    expect((await a.list(store, "hira")).body.invoices).toHaveLength(1);
    expect((await a.list(store, "+92 300 5550002")).body.invoices[0].customerName).toBe("Omar");
  });

  it("gives an older order its invoice, numbered, the first time it is opened", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const noInvoice = await a.order(store);
    const draft = await a.order(store);
    const owner = await connect(urls.owner()); // as it was before invoices were automatic: no invoice, and a draft with no number
    try {
      await owner.query("delete from invoices where order_id = $1", [noInvoice]);
      await owner.query("update invoices set status = 'draft', number = null, finalised_at = null where order_id = $1", [draft]);
      await owner.query("update stores set next_invoice_no = 1 where id = $1", [store]);
    } finally {
      await owner.end();
    }
    expect((await a.get(store, noInvoice)).body.invoice).toMatchObject({ status: "final", number: "SF-0001" });
    expect((await a.get(store, draft)).body.invoice).toMatchObject({ status: "final", number: "SF-0002" });
  });

  it("is private to the owner", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(a.cookie).store();
    const order = await api(a.cookie).order(store);
    expect((await api(b.cookie).get(store, order)).status).toBe(404);
    expect((await api(b.cookie).list(store)).body.invoices).toHaveLength(0);
    expect((await api(a.cookie).get(store, "not-an-id")).status).toBe(404);
  });
});
