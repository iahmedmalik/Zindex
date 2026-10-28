import { createHash, createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import { rows } from "../db/query";

// A delivery card's link holds a token; only the token's SHA-256 hash is stored, so a database leak does not leak
// working links. The token is not random but derived: HMAC(server secret, order id + which link this is for the
// order). That lets the app show the same link again on a later visit (it is made automatically when the order is
// confirmed, and the owner copies it whenever they need it) without ever storing it. Without the server secret the
// links cannot be worked out, and changing the secret switches every old link off.

export const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/** The token for the n-th link (1, 2, 3...) made for an order. 32 characters of base64url. */
export const tokenFor = (secret: string, orderId: string, n: number) => createHmac("sha256", secret).update(`${orderId}:${n}`).digest("base64url").slice(0, 32);

type Live = { id: string; tokenHash: string; expiresAt: Date; position: number };

async function liveRow(tx: Tx, orderId: string): Promise<Live | undefined> {
  const [row] = await rows<Live>(
    tx,
    sql`select c.id, c.token_hash, c.expires_at,
               (select count(*)::int from delivery_cards x where x.order_id = c.order_id and (x.created_at < c.created_at or (x.created_at = c.created_at and x.id <= c.id))) as position
          from delivery_cards c
         where c.order_id = ${orderId} and c.revoked_at is null and c.expires_at > now()
         order by c.created_at desc limit 1`,
  );
  return row;
}

/** The order's live link, or null. `url` is null for an older random link that cannot be shown again (make a new one). */
export async function liveCard(tx: Tx, secret: string, origin: string, orderId: string): Promise<{ url: string | null; expiresAt: Date } | null> {
  const row = await liveRow(tx, orderId);
  if (!row) return null;
  const token = tokenFor(secret, orderId, row.position);
  return { url: hashOf(token) === row.tokenHash ? `${origin}/c/${token}` : null, expiresAt: row.expiresAt };
}

/** Switches off any earlier link and makes a new one. */
export async function makeCard(tx: Tx, secret: string, origin: string, orderId: string, days = 7): Promise<{ token: string; url: string; expiresAt: Date }> {
  await tx.execute(sql`update delivery_cards set revoked_at = now() where order_id = ${orderId} and revoked_at is null`);
  const [{ n }] = (await rows<{ n: number }>(tx, sql`select count(*)::int as n from delivery_cards where order_id = ${orderId}`)) as [{ n: number }];
  const token = tokenFor(secret, orderId, n + 1);
  const [row] = await rows<{ expiresAt: Date }>(
    tx,
    sql`insert into delivery_cards (order_id, token_hash, expires_at)
        values (${orderId}, ${hashOf(token)}, now() + make_interval(days => ${days})) returning expires_at`,
  );
  return { token, url: `${origin}/c/${token}`, expiresAt: row!.expiresAt };
}

/** Makes the link if the order has no live one. Called when an order is confirmed. */
export async function ensureCard(tx: Tx, secret: string, origin: string, orderId: string): Promise<void> {
  if (!(await liveRow(tx, orderId))) await makeCard(tx, secret, origin, orderId);
}
