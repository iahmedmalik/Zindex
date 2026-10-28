import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, connect, newId, newVerifiedOwner, urls } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "put" | "delete", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async () => (await call("post", "/v1/stores", { name: newId("Store"), phone: "0300 0000000" })).body.store.id as string,
    order: async (store: string) =>
      (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", customerPhone: "03001234567", address: "House 4", payment: "cod", riderFee: 350, items: [{ name: "Garam masala", quantity: 2, unitPrice: 450 }] })).body.order.id as string,
    rider: (s: string, o: string) => call("put", `/v1/stores/${s}/orders/${o}/delivery`, { service: "yango", riderName: "Imran", riderPhone: "03217654321", bikeNumber: "LEA-1234" }),
    make: (s: string, o: string, body: object = {}) => call("post", `/v1/stores/${s}/orders/${o}/card`, body),
    revoke: (s: string, o: string) => call("delete", `/v1/stores/${s}/orders/${o}/card`),
    current: (s: string, o: string) => call("get", `/v1/stores/${s}/orders/${o}/card`),
    status: (s: string, o: string, status: string) => call("post", `/v1/stores/${s}/orders/${o}/status`, { status }),
  };
};

const open = (token: string) => request(t.app).get(`/v1/public/card/${token}`);

const tokenOf = (url: string) => url.split("/c/")[1]!;

describe("delivery card, made automatically", () => {
  it("makes the link when the order is confirmed, and shows the same link on every later visit", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    expect((await a.current(store, order)).body.card).toBeNull(); // nothing yet: it is made on confirm

    await a.status(store, order, "confirmed");
    const first = (await a.current(store, order)).body.card;
    expect(first.url).toMatch(/^http:\/\/localhost:3000\/c\/[A-Za-z0-9_-]{32}$/);
    expect(new Date(first.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect((await open(tokenOf(first.url))).status).toBe(200); // no rider saved, and it still works

    await a.status(store, order, "packed");
    expect((await a.current(store, order)).body.card.url).toBe(first.url); // not remade by later steps
  });

  it("replaces the automatic link when the owner makes a new one, and the old link stops working", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    await a.status(store, order, "confirmed");
    const old = (await a.current(store, order)).body.card.url as string;

    const fresh = (await a.make(store, order)).body;
    expect(fresh.url).not.toBe(old);
    expect((await a.current(store, order)).body.card.url).toBe(fresh.url);
    expect((await open(tokenOf(old))).status).toBe(404);
    expect((await open(tokenOf(fresh.url))).status).toBe(200);
  });

  it("makes no link for an order that is cancelled, and none for another owner's order", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    await a.status(store, order, "cancelled");
    expect((await a.current(store, order)).body.card).toBeNull();

    const other = await newVerifiedOwner(t.app, t.mailer);
    const confirmed = await a.order(store);
    await a.status(store, confirmed, "confirmed");
    expect((await api(other.cookie).current(store, confirmed)).status).toBe(404);
  });
});

describe("delivery card", () => {
  it("opens for the customer with no sign-in and shows exactly what the card needs", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    await a.rider(store, order);
    const made = await a.make(store, order);
    expect(made.status).toBe(201);
    expect(made.body.url).toBe(`http://localhost:3000/c/${made.body.token}`);

    const card = await open(made.body.token);
    expect(card.status).toBe(200);
    expect(card.headers["cache-control"]).toBe("no-store");
    expect(card.headers["x-robots-tag"]).toContain("noindex");
    expect(card.body.card.order).toMatchObject({ customerName: "Ayesha", total: 900, riderFee: 350, collectAtDoor: 1250 });
    expect(card.body.card.delivery).toMatchObject({ riderName: "Imran", bikeNumber: "LEA-1234", riderPhone: "03217654321", status: "pending" });
    expect(card.body.card.store.name).toBeTruthy();
    // Nothing private leaks: no customer phone, no ids, no owner.
    const text = JSON.stringify(card.body);
    expect(text).not.toContain("03001234567");
    expect(text).not.toContain(o.id);
  });

  it("answers 404 for a wrong, malformed or revoked link, and for an expired one", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    const { token } = (await a.make(store, order)).body;

    expect((await open("x".repeat(32))).status).toBe(404);
    expect((await open("short")).status).toBe(404);
    expect((await open(token)).status).toBe(200);
    expect((await a.revoke(store, order)).body.revoked).toBe(1);
    expect((await open(token)).status).toBe(404);

    const second = (await a.make(store, order, { days: 1 })).body.token as string;
    expect((await open(second)).status).toBe(200);
    const owner = await connect(urls.owner());
    await owner.query("update delivery_cards set expires_at = now() - interval '1 minute' where order_id = $1", [order]);
    await owner.end();
    expect((await open(second)).status).toBe(404);
  });

  it("switches off the old link when a new one is made", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    const first = (await a.make(store, order)).body.token as string;
    const second = (await a.make(store, order)).body.token as string;
    expect((await open(first)).status).toBe(404);
    expect((await open(second)).status).toBe(200);
  });

  it("stores only a hash of the link, never the link itself", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    const { token } = (await a.make(store, order)).body;
    const owner = await connect(urls.owner());
    const found = await owner.query("select token_hash from delivery_cards where order_id = $1", [order]);
    await owner.end();
    expect(found.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(found.rows[0].token_hash).not.toContain(token);
  });

  it("lets only the owner make or revoke a card, and rejects a cancelled order", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(a.cookie).store();
    const order = await api(a.cookie).order(store);
    expect((await api(b.cookie).make(store, order)).status).toBe(404);
    const { token } = (await api(a.cookie).make(store, order)).body;
    expect((await api(b.cookie).revoke(store, order)).body.revoked).toBe(0);
    expect((await open(token)).status).toBe(200);
    expect((await api(a.cookie).make(store, order, { days: 99 })).status).toBe(400);
    await request(t.app).post(`/v1/stores/${store}/orders/${order}/status`).set("Cookie", a.cookie).send({ status: "cancelled" });
    expect((await api(a.cookie).make(store, order)).status).toBe(409);
  });
});
