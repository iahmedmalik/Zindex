import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createDb } from "../src/db/client";
import { memoryMailer } from "../src/mailer";
import { hit } from "../src/rate-limit";
import { buildTestApp, newId, ORIGIN, testConfig, urls } from "./helpers";

const SECRET = "proxy-secret-proxy-secret";

describe("shared counters (hit)", () => {
  const { db, pool } = createDb(urls.app());
  afterAll(() => pool.end());

  it("allows up to the limit, then blocks with a wait time", async () => {
    const key = newId("hit");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit(db, key, 3, 60_000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfter).toBeGreaterThan(0);
    expect(results[3]!.retryAfter).toBeLessThanOrEqual(60);
  });

  it("starts counting again once the window is over", async () => {
    const key = newId("window");
    await hit(db, key, 1, 50);
    expect((await hit(db, key, 1, 50)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect((await hit(db, key, 1, 50)).allowed).toBe(true);
  });

  it("counts correctly when many copies hit at the same moment", async () => {
    const key = newId("burst");
    const results = await Promise.all(Array.from({ length: 20 }, () => hit(db, key, 5, 60_000)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
  });
});

describe("two copies of the API share one count", () => {
  it("blocks sign-in on copy B after copy A used up the tries", async () => {
    const a = buildTestApp({ rateLimit: { enabled: true, signInMax: 3 } });
    const b = buildTestApp({ rateLimit: { enabled: true, signInMax: 3 } });
    const address = `${newId("share")}@example.com`;
    // Same visitor address on both copies (the proxy says so), so they must share one counter.
    const body = { email: address, password: "wrong-password-123" };
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await request(a.app).post("/v1/auth/sign-in/email").set("Origin", ORIGIN).set("x-forwarded-for", "198.51.100.77").send(body)).status);
    expect(statuses).not.toContain(429);
    const onB = await request(b.app).post("/v1/auth/sign-in/email").set("Origin", ORIGIN).set("x-forwarded-for", "198.51.100.77").send(body);
    expect(onB.status).toBe(429);
    await a.close();
    await b.close();
  });
});

describe("who the visitor is behind the web app's proxy", () => {
  const { db, pool } = createDb(urls.app());
  const config = { ...testConfig, PROXY_SECRET: SECRET };
  const app = createApp({ config, db, auth: createAuth(db, config, memoryMailer(), { rateLimit: { enabled: true, signInMax: 2 } }) });
  afterAll(() => pool.end());

  const tryIn = (ip: string, proof?: string) => {
    const req = request(app).post("/v1/auth/sign-in/email").set("Origin", ORIGIN).set("x-zindex-client-ip", ip);
    if (proof) req.set("x-zindex-proxy", proof);
    return req.send({ email: `${newId("who")}@example.com`, password: "wrong-password-123" });
  };

  it("counts each visitor separately when the secret matches", async () => {
    const one = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const two = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
    for (let i = 0; i < 2; i++) expect((await tryIn(one, SECRET)).status).not.toBe(429);
    expect((await tryIn(one, SECRET)).status).toBe(429);
    expect((await tryIn(two, SECRET)).status).not.toBe(429);
  });

  it("ignores a claimed address without the right secret", async () => {
    // Everyone without proof is the same visitor (the test client), however many addresses they claim.
    const statuses: number[] = [];
    const seenAs = `203.0.113.${Math.floor(Math.random() * 200) + 1}`; // what the server itself sees (not the claim)
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post("/v1/auth/sign-in/email").set("Origin", ORIGIN).set("x-forwarded-for", seenAs)
        .set("x-zindex-client-ip", `198.51.100.${i + 1}`).set("x-zindex-proxy", "wrong-secret-wrong-secret")
        .send({ email: `${newId("who")}@example.com`, password: "wrong-password-123" });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

describe("delivery card and demo limits live in the database too", () => {
  it("stops a visitor after the demo allowance", async () => {
    const t = buildTestApp();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await request(t.app).post("/v1/demo/start").set("x-forwarded-for", "198.51.100.200")).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(2);
    await t.close();
  });
});
