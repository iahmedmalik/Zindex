import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createDb } from "../src/db/client";
import { memoryMailer } from "../src/mailer";
import { DEMO_LIMITS } from "../src/routes/demo";
import { PASSWORD, connect, cookieOf, newId, post, testConfig, urls } from "./helpers";

// "Try the demo": the API signs the demo owner in itself, seeds preloaded data once, keeps the demo
// inside its guard rails, and wipes and re-seeds it when it is a day old. Real local Postgres.

const demoEmail = `${newId("demo")}@example.test`;
const config = { ...testConfig, OWNER_EMAILS: "someone@example.com", DEMO_EMAIL: demoEmail, DEMO_PASSWORD: "public-demo-password" };
const { db, pool } = createDb(urls.app());
const mailer = memoryMailer();
const app = createApp({ config, db, auth: createAuth(db, config, mailer) });
afterAll(() => pool.end());

const start = () => request(app).post("/v1/demo/start");
const storesOf = async (cookie: string) => (await request(app).get("/v1/stores").set("Cookie", cookie)).body.stores as { id: string; name: string }[];

describe("the demo account", () => {
  it("is off unless it is configured", async () => {
    const off = createApp({ config: { ...testConfig, DEMO_EMAIL: undefined, DEMO_PASSWORD: undefined }, db, auth: createAuth(db, testConfig, mailer) });
    expect((await request(off).post("/v1/demo/start")).status).toBe(404);
  });

  it("signs a visitor in without a password and shows preloaded stores and orders", async () => {
    const res = await start();
    expect(res.status).toBe(200);
    const cookie = cookieOf(res);
    expect(cookie).toContain("session_token");

    const me = await request(app).get("/v1/me").set("Cookie", cookie);
    expect(me.body.user).toMatchObject({ email: demoEmail, demo: true });

    const stores = await storesOf(cookie);
    expect(stores.map((s) => s.name).sort()).toEqual(["Sheen Food", "Sheen Perfumes", "The Sheen Store"]);
    const food = stores.find((s) => s.name === "Sheen Food")!;
    const orders = await request(app).get(`/v1/stores/${food.id}/orders`).set("Cookie", cookie);
    expect(orders.body.orders.length).toBeGreaterThanOrEqual(3);
    expect(mailer.sent.some((m) => m.to === demoEmail)).toBe(false); // nobody reads the demo address
  }, 60_000);

  it("does not seed twice when it is opened again", async () => {
    const cookie = cookieOf(await start());
    expect(await storesOf(cookie)).toHaveLength(3);
  }, 60_000);

  it("keeps the demo inside its guard rails", async () => {
    const cookie = cookieOf(await start());
    const [store] = await storesOf(cookie);
    expect((await request(app).get("/v1/backup").set("Cookie", cookie)).status).toBe(403);
    expect((await request(app).get(`/v1/stores/${store!.id}/shopify`).set("Cookie", cookie)).status).toBe(403);
    const change = await post(app, "/v1/auth/change-password", { currentPassword: "public-demo-password", newPassword: "another-long-password" }).set("Cookie", cookie);
    expect(change.status).toBe(403);
    const reset = await post(app, "/v1/auth/request-password-reset", { email: demoEmail, redirectTo: "http://localhost:3000/reset-password" });
    expect(reset.status).toBe(403);

    // The caps stop a visitor from filling the free database.
    const before = (await request(app).get(`/v1/stores/${store!.id}/orders`).set("Cookie", cookie)).body.orders.length as number;
    const cap = DEMO_LIMITS.orders;
    DEMO_LIMITS.orders = before; // only for this test: the demo already has exactly this many
    try {
      const refused = await request(app).post(`/v1/stores/${store!.id}/orders`).set("Cookie", cookie).send({ customerName: "Extra", items: [{ name: "Thing", quantity: 1, unitPrice: 100 }], payment: "cod" });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toMatch(/up to/);
    } finally {
      DEMO_LIMITS.orders = cap;
    }
  }, 60_000);

  it("is still invitation-only for everybody else, and still lets a listed owner in", async () => {
    const stranger = await post(app, "/v1/auth/sign-up/email", { name: "X", email: "stranger@example.com", password: PASSWORD });
    expect(stranger.status).toBe(403);
    const listed = await post(app, "/v1/auth/sign-up/email", { name: "Some One", email: "someone@example.com", password: PASSWORD });
    expect(listed.status).toBe(200);
  });

  it("wipes and re-seeds a demo that is more than a day old", async () => {
    const cookie = cookieOf(await start());
    const before = (await storesOf(cookie)).map((s) => s.id).sort();
    const owner = await connect(urls.owner());
    try {
      await owner.query(`update stores set created_at = now() - interval '2 days' where owner_id = (select id from "user" where email = $1)`, [demoEmail]);
    } finally {
      await owner.end();
    }
    const again = cookieOf(await start());
    const after = (await storesOf(again)).map((s) => s.id).sort();
    expect(after).toHaveLength(3);
    expect(after.some((id) => before.includes(id))).toBe(false); // new rows, not the old ones
  }, 90_000);
});
