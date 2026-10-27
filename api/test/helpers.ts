import { randomBytes } from "node:crypto";
import request from "supertest";
import type { Express } from "express";
import { Client } from "pg";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import type { Config } from "../src/config";
import { createDb } from "../src/db/client";
import { memoryMailer } from "../src/mailer";

// Connection strings for the throwaway local Postgres started by global-setup.ts.
export const urls = {
  owner: () => process.env.TEST_OWNER_URL as string,
  app: () => process.env.TEST_APP_URL as string,
};

export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "a-long-enough-password";

export const testConfig: Config = {
  DATABASE_URL_APP: "",
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-test-secret",
  WEB_ORIGIN: ORIGIN,
  MAIL_FROM: "Zindex <test@example.com>",
  PORT: 4000,
  NODE_ENV: "test",
  isProduction: false,
};

export async function connect(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

/** A fresh id or name part for a test, so tests never trip over each other. */
export const newId = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex")}`;

/** The real Express app on the real local database, with mail kept in memory so tests can read the links. */
export function buildTestApp(options?: Parameters<typeof createAuth>[3]) {
  const { db, pool } = createDb(urls.app());
  const mailer = memoryMailer();
  const app: Express = createApp({ config: testConfig, db, auth: createAuth(db, testConfig, mailer, options) });
  return { app, db, mailer, close: () => pool.end() };
}

export const cookieOf = (res: request.Response) =>
  (res.headers["set-cookie"] as unknown as string[] | undefined)?.map((c) => c.split(";")[0]).join("; ") ?? "";

export const post = (app: Express, path: string, body: object) => request(app).post(path).set("Origin", ORIGIN).send(body);

/** Signs an owner up, follows the emailed link, and returns the session cookie. */
export async function newVerifiedOwner(app: Express, mailer: { sent: { to: string; text: string }[] }, name = "Test Owner") {
  const email = `${newId("owner")}@example.com`;
  await post(app, "/v1/auth/sign-up/email", { name, email, password: PASSWORD });
  const link = linkFor(mailer, email);
  const verified = await request(app).get(new URL(link).pathname + new URL(link).search);
  return { email, cookie: cookieOf(verified), id: await userIdOf(app, cookieOf(verified)) };
}

export function linkFor(mailer: { sent: { to: string; text: string }[] }, email: string): string {
  const mail = [...mailer.sent].reverse().find((m) => m.to === email);
  const link = mail && /(https?:\/\/\S+)/.exec(mail.text)?.[1];
  if (!link) throw new Error(`No email with a link was sent to ${email}`);
  return link;
}

async function userIdOf(app: Express, cookie: string): Promise<string> {
  const me = await request(app).get("/v1/me").set("Cookie", cookie);
  return me.body.user.id as string;
}

/**
 * Runs `fn` the way the API does for one signed-in owner: inside a transaction with
 * app.owner_id set. Always rolls back, so a test never changes what the next test sees.
 */
export async function asOwner<T>(app: Client, ownerId: string | null, fn: () => Promise<T>): Promise<T> {
  await app.query("begin");
  try {
    if (ownerId !== null) await app.query("select set_config('app.owner_id', $1, true)", [ownerId]);
    return await fn();
  } finally {
    await app.query("rollback");
  }
}

/** True when the promise fails with a Postgres "permission denied" error. */
export async function denied(promise: Promise<unknown>): Promise<boolean> {
  try {
    await promise;
    return false;
  } catch (err) {
    return /permission denied|row-level security|must be owner/i.test((err as Error).message);
  }
}
