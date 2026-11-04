import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import type { RequestHandler } from "express";
import type { Db } from "./db/client";
import { HttpError } from "./http-error";

// Rate limits kept in the database (table rate_limit, sql/029), so every copy of the API shares one count.

/**
 * Counts one hit for `key` in a fixed window and says whether it is still allowed. One atomic statement, so
 * two copies hitting at the same moment cannot both read the old count.
 */
export async function hit(db: Db, key: string, max: number, windowMs: number): Promise<{ allowed: boolean; retryAfter: number }> {
  const now = Date.now();
  const expired = now - windowMs;
  const result = await db.execute(sql`
    insert into rate_limit (id, key, count, last_request)
    values (${`rl-${key}`}, ${key}, 1, ${now})
    on conflict (key) do update set
      count = case when rate_limit.last_request <= ${expired} then 1 else rate_limit.count + 1 end,
      last_request = case when rate_limit.last_request <= ${expired} then ${now} else rate_limit.last_request end
    returning count, last_request`);
  const row = result.rows[0] as { count: number; last_request: string | number };
  return { allowed: row.count <= max, retryAfter: Math.max(1, Math.ceil((Number(row.last_request) + windowMs - now) / 1000)) };
}

/** Express middleware: at most `max` requests per visitor address per window for the named group. */
export function limitBy(db: Db, group: string, max: number, windowMs: number, message: string): RequestHandler {
  return async (req, res, next) => {
    try {
      const { allowed, retryAfter } = await hit(db, `${group}:${req.ip ?? "?"}`, max, windowMs);
      if (allowed) return next();
      res.setHeader("Retry-After", String(retryAfter));
      next(new HttpError(429, message));
    } catch (err) {
      next(err);
    }
  };
}

/** Removes counters whose window is long over (called from the daily jobs). */
export async function clearOldCounters(db: Db, olderThanMs = 24 * 60 * 60 * 1000): Promise<void> {
  await db.execute(sql`delete from rate_limit where last_request < ${Date.now() - olderThanMs}`);
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * On Vercel the API only sees the web app's address, never the visitor's. The web app's /backend proxy sends the
 * visitor's address in x-zindex-client-ip together with a shared secret; when the secret matches, that address
 * becomes the request's address (for these limits, for Better Auth's and for the session record). Without a match
 * the header is ignored, so nobody can pretend to be someone else.
 */
export function trustProxyClient(secret: string | undefined): RequestHandler {
  return (req, _res, next) => {
    const claimed = req.headers["x-zindex-client-ip"];
    const proof = req.headers["x-zindex-proxy"];
    if (secret && typeof claimed === "string" && typeof proof === "string" && timingSafeEqual(digest(proof), digest(secret))) {
      req.headers["x-forwarded-for"] = claimed.split(",")[0]!.trim();
    }
    next();
  };
}
