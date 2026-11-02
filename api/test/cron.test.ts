import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createDb } from "../src/db/client";
import { memoryMailer } from "../src/mailer";
import { testConfig, urls } from "./helpers";

// The daily jobs that Vercel's cron calls, because a Vercel function cannot keep timers. Real local Postgres.

const { db, pool } = createDb(urls.app());
const build = (extra: object) => {
  const config = { ...testConfig, ...extra };
  return createApp({ config, db, auth: createAuth(db, config, memoryMailer()) });
};
afterAll(() => pool.end());

const SECRET = "a-long-enough-cron-secret";

describe("the daily cron route", () => {
  it("does not exist unless CRON_SECRET is set", async () => {
    const res = await request(build({})).get("/internal/cron/daily").set("Authorization", `Bearer ${SECRET}`);
    expect(res.status).toBe(404);
  });

  it("refuses a missing or wrong secret", async () => {
    const app = build({ CRON_SECRET: SECRET });
    expect((await request(app).get("/internal/cron/daily")).status).toBe(401);
    expect((await request(app).get("/internal/cron/daily").set("Authorization", "Bearer nope")).status).toBe(401);
    expect((await request(app).get("/internal/cron/daily").set("Authorization", SECRET)).status).toBe(401);
  });

  it("runs the photo cleanup with the right secret, and leaves the demo off when it is not configured", async () => {
    const res = await request(build({ CRON_SECRET: SECRET })).get("/internal/cron/daily").set("Authorization", `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removedPhotos: expect.any(Number), demo: "off" });
  });
});
