import { sql } from "drizzle-orm";
import { Router, type RequestHandler } from "express";
import type { AppContext } from "../app";
import { asOwner } from "../db/client";
import { stores } from "../db/schema";
import { seedDemo, type Call } from "../demo-seed";
import { HttpError } from "../http-error";

// "Try the demo": anyone can open a preloaded account without typing a password. The API signs the
// demo owner in itself (the password never reaches the browser) and hands back the session cookie.
// The demo is one shared account, so its data is wiped and re-seeded once it is a day old.

const DAY = 24 * 60 * 60 * 1000;
export const DEMO_LIMITS = { stores: 5, orders: 40 };

export const demoEmails = (ctx: Pick<AppContext, "config">) =>
  (ctx.config.DEMO_EMAIL ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);

/** Requests to this same server, as the demo owner (the seed uses the real routes, so the rules apply to it too). */
const loopback = (base: string, cookie: string): Call => async (method, path, body) => {
  const res = await fetch(`${base}/v1${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  return { status: res.status, data: data as never };
};

async function signInDemo(ctx: AppContext) {
  const email = demoEmails(ctx)[0]!;
  const password = ctx.config.DEMO_PASSWORD!;
  const attempt = () => ctx.auth.api.signInEmail({ body: { email, password }, asResponse: true });
  let res = await attempt();
  if (!res.ok) {
    // First run: the demo owner does not exist yet. The sign-up hook lets the demo address in and marks it verified.
    await ctx.auth.api.signUpEmail({ body: { name: "Demo Owner", email, password } }).catch(() => undefined);
    res = await attempt();
    if (!res.ok) throw new HttpError(503, "The demo is not available right now.");
  }
  const setCookies = res.headers.getSetCookie();
  const body = (await res.clone().json()) as { user: { id: string } };
  return { setCookies, cookie: setCookies.map((c) => c.split(";")[0]).join("; "), userId: body.user.id };
}

let running: Promise<unknown> | null = null;

/** Signs the demo owner in and makes sure its data exists and is less than a day old. `base` is this server's own address. */
export async function ensureDemo(ctx: AppContext, base: string) {
  while (running) await running.catch(() => undefined);
  const job = (async () => {
    const session = await signInDemo(ctx);
    const { rows } = await asOwner(ctx.db, session.userId, (tx) => tx.execute(sql`select min(created_at) as oldest, count(*)::int as n from stores`));
    const { oldest, n } = rows[0] as { oldest: Date | null; n: number };
    const stale = n > 0 && oldest !== null && Date.now() - new Date(oldest).getTime() > DAY;
    if (n === 0 || stale) {
      if (stale) await asOwner(ctx.db, session.userId, (tx) => tx.delete(stores)); // everything else hangs off the stores and goes with them
      try {
        await seedDemo(loopback(base, session.cookie));
      } catch (err) {
        await asOwner(ctx.db, session.userId, (tx) => tx.delete(stores)); // start clean next time
        throw err;
      }
    }
    return session;
  })();
  running = job;
  try {
    return await job;
  } finally {
    running = null;
  }
}

// A small per-address limit: opening the demo does real work (sign-in, sometimes a re-seed).
const hits = new Map<string, number[]>();
const limited: RequestHandler = (req, _res, next) => {
  const now = Date.now();
  const who = req.ip ?? "?";
  const recent = (hits.get(who) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 10) return next(new HttpError(429, "Too many tries. Wait a minute and try again."));
  hits.set(who, [...recent, now]);
  next();
};

export function demoRouter(ctx: AppContext): Router {
  const router = Router();
  router.post("/start", limited, async (req, res) => {
    if (!ctx.config.DEMO_EMAIL || !ctx.config.DEMO_PASSWORD) throw new HttpError(404, "The demo is not switched on.");
    const session = await ensureDemo(ctx, `http://127.0.0.1:${req.socket.localPort}`);
    for (const cookie of session.setCookies) res.append("Set-Cookie", cookie);
    res.json({ ok: true });
  });
  return router;
}

/** For signed-in demo visitors: what the demo may not do, and how much it may add. */
export function demoGuard(ctx: AppContext): RequestHandler {
  const emails = demoEmails(ctx);
  const blocked = [/^\/backup/, /^\/stores\/[^/]+\/shopify/];
  const count = async (userId: string, table: "stores" | "orders") => {
    const { rows } = await asOwner(ctx.db, userId, (tx) => tx.execute(sql`select count(*)::int as n from ${sql.raw(table)}`));
    return (rows[0] as { n: number }).n;
  };
  return async (req, _res, next) => {
    try {
      if (!emails.includes(req.user!.email.toLowerCase())) return next();
      if (blocked.some((rx) => rx.test(req.path))) throw new HttpError(403, "Not available in the demo.");
      const adding = req.method === "POST";
      if (adding && req.path === "/stores" && (await count(req.user!.id, "stores")) >= DEMO_LIMITS.stores) {
        throw new HttpError(403, `The demo allows up to ${DEMO_LIMITS.stores} stores.`);
      }
      if (adding && /^\/stores\/[^/]+\/orders$/.test(req.path) && (await count(req.user!.id, "orders")) >= DEMO_LIMITS.orders) {
        throw new HttpError(403, `The demo allows up to ${DEMO_LIMITS.orders} orders. It resets every day.`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
