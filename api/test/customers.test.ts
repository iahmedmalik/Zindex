import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { normalisePhone } from "../src/phone";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => ({
  store: async (name = newId("Store")) => (await request(t.app).post("/v1/stores").set("Cookie", cookie).send({ name })).body.store.id as string,
  save: (storeId: string, body: object) => request(t.app).post(`/v1/stores/${storeId}/customers`).set("Cookie", cookie).send(body),
  list: (storeId: string, q = "") => request(t.app).get(`/v1/stores/${storeId}/customers?q=${encodeURIComponent(q)}`).set("Cookie", cookie),
});

describe("normalisePhone", () => {
  it("turns every way of writing a Pakistani mobile into one", () => {
    for (const raw of ["0300 1234567", "+92 300 1234567", "92-300-1234567", "(0300) 123-4567", "0092 300 1234567", "3001234567"]) {
      expect(normalisePhone(raw)).toBe("03001234567");
    }
  });
});

describe("customers", () => {
  it("saves a customer, finds them by name or any spelling of the phone, and edits them", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const made = await a.save(store, { name: "Ayesha Khan", phone: "+92 300 1234567", addresses: ["House 4, Street 2, Model Town"] });
    expect(made.status).toBe(201);
    expect(made.body.customer).toMatchObject({ name: "Ayesha Khan", phone: "03001234567" });

    expect((await a.list(store, "ayesha")).body.customers).toHaveLength(1);
    expect((await a.list(store, "0300-123")).body.customers).toHaveLength(1);
    expect((await a.list(store, "zzz")).body.customers).toHaveLength(0);

    const id = made.body.customer.id as string;
    const edited = await request(t.app).patch(`/v1/stores/${store}/customers/${id}`).set("Cookie", o.cookie).send({ notes: "Call before arriving", addresses: ["New address"] });
    expect(edited.body.customer).toMatchObject({ notes: "Call before arriving", addresses: ["New address"] });
    expect((await request(t.app).delete(`/v1/stores/${store}/customers/${id}`).set("Cookie", o.cookie)).status).toBe(204);
  });

  it("does not make a second customer for the same phone: it updates and adds the new address", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    await a.save(store, { name: "Bilal", phone: "03211234567", addresses: ["Address one"] });
    const again = await a.save(store, { name: "Bilal Ahmed", phone: "+92 321 1234567", addresses: ["Address two"] });
    expect(again.status).toBe(200);
    expect(again.body.customer.name).toBe("Bilal Ahmed");
    expect(again.body.customer.addresses.sort()).toEqual(["Address one", "Address two"]);
    expect((await a.list(store)).body.customers).toHaveLength(1);
  });

  it("keeps the same person in two stores as two separate customers", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const food = await a.store("Sheen Food");
    const shop = await a.store("The Sheen Store");
    await a.save(food, { name: "Sana", phone: "03331234567" });
    await a.save(shop, { name: "Sana", phone: "03331234567" });
    expect((await a.list(food)).body.customers).toHaveLength(1);
    expect((await a.list(shop)).body.customers).toHaveLength(1);
  });

  it("never shows one owner another owner's customers", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(a.cookie).store();
    const c = (await api(a.cookie).save(store, { name: "Private", phone: "03001112223" })).body.customer;
    expect((await api(b.cookie).list(store)).body.customers).toHaveLength(0);
    expect((await api(b.cookie).save(store, { name: "Planted", phone: "03001112224" })).status).toBe(404);
    expect((await request(t.app).get(`/v1/stores/${store}/customers/${c.id}`).set("Cookie", b.cookie)).status).toBe(404);
    expect((await request(t.app).delete(`/v1/stores/${store}/customers/${c.id}`).set("Cookie", b.cookie)).status).toBe(404);
  });

  it("refuses a bad phone, an empty name and unknown fields", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    expect((await a.save(store, { name: "X", phone: "12" })).status).toBe(400);
    expect((await a.save(store, { name: "", phone: "03001234567" })).status).toBe(400);
    expect((await a.save(store, { name: "X", phone: "03001234567", ownerId: "other" })).status).toBe(400);
  });
});
