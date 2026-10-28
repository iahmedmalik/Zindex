import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

// Stores through the real Express app, including the rule that matters most for an app anyone can
// sign up to: one owner can never see or change another owner's stores.

const t = buildTestApp();
afterAll(() => t.close());

const createStore = (cookie: string, body: object) => request(t.app).post("/v1/stores").set("Cookie", cookie).send(body);

describe("stores", () => {
  it("needs a signed-in owner", async () => {
    expect((await request(t.app).get("/v1/stores")).status).toBe(401);
  });

  it("creates, lists, renames and deletes an owner's own store", async () => {
    const owner = await newVerifiedOwner(t.app, t.mailer);
    const made = await createStore(owner.cookie, { name: "Sheen Food", invoicePrefix: "SF", accent: "#71212a" });
    expect(made.status).toBe(201);
    expect(made.body.store).toMatchObject({ name: "Sheen Food", invoicePrefix: "SF", accent: "#71212a" });
    expect(made.body.store).not.toHaveProperty("nextInvoiceNo");

    const list = await request(t.app).get("/v1/stores").set("Cookie", owner.cookie);
    expect(list.body.stores).toHaveLength(1);

    const id = made.body.store.id as string;
    const renamed = await request(t.app).patch(`/v1/stores/${id}`).set("Cookie", owner.cookie).send({ name: "Sheen Foods", phone: "0300 0000000" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.store).toMatchObject({ name: "Sheen Foods", phone: "0300 0000000" });

    expect((await request(t.app).delete(`/v1/stores/${id}`).set("Cookie", owner.cookie)).status).toBe(204);
    expect((await request(t.app).get("/v1/stores").set("Cookie", owner.cookie)).body.stores).toHaveLength(0);
  });

  it("clears a store's phone, email and address when they are sent as null", async () => {
    const owner = await newVerifiedOwner(t.app, t.mailer);
    const made = await createStore(owner.cookie, { name: newId("Clear"), phone: "0300 1", email: "shop@example.com", address: "Lahore" });
    expect(made.body.store).toMatchObject({ phone: "0300 1", email: "shop@example.com", address: "Lahore" });
    const cleared = await request(t.app).patch(`/v1/stores/${made.body.store.id}`).set("Cookie", owner.cookie).send({ phone: null, email: null, address: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.store).toMatchObject({ phone: null, email: null, address: null });
    const badName = await request(t.app).patch(`/v1/stores/${made.body.store.id}`).set("Cookie", owner.cookie).send({ name: null });
    expect(badName.status).toBe(400);
  });

  it("keeps two owners' stores apart", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer, "Owner A");
    const b = await newVerifiedOwner(t.app, t.mailer, "Owner B");
    const store = (await createStore(a.cookie, { name: newId("A store") })).body.store;

    expect((await request(t.app).get("/v1/stores").set("Cookie", b.cookie)).body.stores).toHaveLength(0);
    expect((await request(t.app).patch(`/v1/stores/${store.id}`).set("Cookie", b.cookie).send({ name: "Stolen" })).status).toBe(404);
    expect((await request(t.app).delete(`/v1/stores/${store.id}`).set("Cookie", b.cookie)).status).toBe(404);

    const still = await request(t.app).get("/v1/stores").set("Cookie", a.cookie);
    expect(still.body.stores[0].name).not.toBe("Stolen");
    expect(still.body.stores).toHaveLength(1);
  });

  it("lets two owners use the same store name but not one owner twice", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    expect((await createStore(a.cookie, { name: "Sheen Perfumes" })).status).toBe(201);
    expect((await createStore(b.cookie, { name: "Sheen Perfumes" })).status).toBe(201);
    const again = await createStore(a.cookie, { name: "Sheen Perfumes" });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already have a store/);
  });

  it("refuses invalid and unknown fields", async () => {
    const owner = await newVerifiedOwner(t.app, t.mailer);
    expect((await createStore(owner.cookie, { name: "" })).status).toBe(400);
    expect((await createStore(owner.cookie, { name: "X", accent: "red" })).status).toBe(400);
    expect((await createStore(owner.cookie, { name: "X", invoicePrefix: "toolongprefix" })).status).toBe(400);
    expect((await createStore(owner.cookie, { name: "X", ownerId: "someone-else" })).status).toBe(400);
    expect((await createStore(owner.cookie, { name: "X", nextInvoiceNo: 99 })).status).toBe(400);
    expect((await request(t.app).patch("/v1/stores/not-an-id").set("Cookie", owner.cookie).send({ name: "Y" })).status).toBe(404);
  });
});
