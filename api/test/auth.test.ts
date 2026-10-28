import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createDb } from "../src/db/client";
import { memoryMailer } from "../src/mailer";
import { ORIGIN, PASSWORD, buildTestApp, cookieOf, linkFor, newId, post, testConfig, urls } from "./helpers";

// Sign-up, email verification and sign-in against a real local Postgres, through the real Express app.

const t = buildTestApp();
afterAll(() => t.close());

const email = () => `${newId("owner")}@example.com`;

describe("sign-up needs a verified email", () => {
  it("sends a verification email and does not sign the new owner in", async () => {
    const address = email();
    const res = await post(t.app, "/v1/auth/sign-up/email", { name: "Ali", email: address, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(cookieOf(res)).not.toContain("session_token");
    expect(t.mailer.sent.some((m) => m.to === address && m.subject.includes("Confirm"))).toBe(true);
  });

  it("refuses sign-in until the email is verified, then signs in after the link is followed", async () => {
    const address = email();
    await post(t.app, "/v1/auth/sign-up/email", { name: "Sana", email: address, password: PASSWORD });

    const early = await post(t.app, "/v1/auth/sign-in/email", { email: address, password: PASSWORD });
    expect(early.status).toBe(403);

    const link = new URL(linkFor(t.mailer, address));
    const verified = await request(t.app).get(link.pathname + link.search);
    expect(cookieOf(verified)).toContain("session_token");

    const login = await post(t.app, "/v1/auth/sign-in/email", { email: address, password: PASSWORD });
    expect(login.status).toBe(200);
    const me = await request(t.app).get("/v1/me").set("Cookie", cookieOf(login));
    expect(me.body.user.email).toBe(address);
  });

  it("sends a fresh confirmation link when someone signs in before confirming, and none once confirmed", async () => {
    const address = email();
    await post(t.app, "/v1/auth/sign-up/email", { name: "Zara", email: address, password: PASSWORD });
    const confirmations = () => t.mailer.sent.filter((m) => m.to === address && m.subject.includes("Confirm")).length;
    expect(confirmations()).toBe(1);

    const early = await post(t.app, "/v1/auth/sign-in/email", { email: address, password: PASSWORD });
    expect(early.status).toBe(403);
    expect(early.body.message).toMatch(/not verified/i); // the sign-in page looks for this wording
    expect(confirmations()).toBe(2);

    const link = new URL(linkFor(t.mailer, address));
    await request(t.app).get(link.pathname + link.search);
    const login = await post(t.app, "/v1/auth/sign-in/email", { email: address, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(confirmations()).toBe(2);
  });

  it("answers /v1/me with 401 and a plain message when nobody is signed in", async () => {
    const res = await request(t.app).get("/v1/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Please sign in." });
  });

  it("rejects a short password and a wrong password", async () => {
    const short = await post(t.app, "/v1/auth/sign-up/email", { name: "X", email: email(), password: "short" });
    expect(short.status).toBe(400);

    const address = email();
    await post(t.app, "/v1/auth/sign-up/email", { name: "Omar", email: address, password: PASSWORD });
    const link = new URL(linkFor(t.mailer, address));
    await request(t.app).get(link.pathname + link.search);
    const wrong = await post(t.app, "/v1/auth/sign-in/email", { email: address, password: "not-the-password-1" });
    expect(wrong.status).toBe(401);
  });
});

describe("password reset", () => {
  it("emails a reset link that sets a new password", async () => {
    const address = email();
    await post(t.app, "/v1/auth/sign-up/email", { name: "Hina", email: address, password: PASSWORD });
    const verifyLink = new URL(linkFor(t.mailer, address));
    await request(t.app).get(verifyLink.pathname + verifyLink.search);

    const ask = await post(t.app, "/v1/auth/request-password-reset", { email: address, redirectTo: `${ORIGIN}/reset` });
    expect(ask.status).toBe(200);
    const mail = [...t.mailer.sent].reverse().find((m) => m.to === address && m.subject.includes("Reset"));
    expect(mail).toBeDefined();

    const token = /reset-password\/([^?\s]+)/.exec(mail!.text)?.[1];
    expect(token).toBeTruthy();
    const reset = await post(t.app, "/v1/auth/reset-password", { token, newPassword: "a-brand-new-password" });
    expect(reset.status).toBe(200);

    const login = await post(t.app, "/v1/auth/sign-in/email", { email: address, password: "a-brand-new-password" });
    expect(login.status).toBe(200);
  });
});

describe("sign-in rate limit", () => {
  it("slows down repeated wrong passwords", async () => {
    const limited = buildTestApp({ rateLimit: { enabled: true, signInMax: 3 } });
    const address = email();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await post(limited.app, "/v1/auth/sign-in/email", { email: address, password: "wrong-password-123" });
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
    await limited.close();
  });
});

describe("sign-up by invitation", () => {
  const restricted = (() => {
    const { db, pool } = createDb(urls.app());
    const mailer = memoryMailer();
    const config = { ...testConfig, OWNER_EMAILS: "Boss@Example.com, second@example.com", DEMO_EMAIL: "demo@example.com" };
    return { app: createApp({ config, db, auth: createAuth(db, config, mailer) }), close: () => pool.end() };
  })();
  afterAll(() => restricted.close());

  it("lets a listed address sign up, whatever its letter case", async () => {
    const res = await post(restricted.app, "/v1/auth/sign-up/email", { name: "Boss", email: "boss@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("refuses an address that is not listed, with a plain message", async () => {
    const res = await post(restricted.app, "/v1/auth/sign-up/email", { name: "Stranger", email: "stranger@example.com", password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/invitation/i);
  });

  it("always lets the demo address exist", async () => {
    const res = await post(restricted.app, "/v1/auth/sign-up/email", { name: "Demo", email: "demo@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
  });
});
