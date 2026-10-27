import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Neon's free compute sleeps after 5 minutes; waking can take a second or two, so be patient.
export function createPool(connectionString: string, max = 5): Pool {
  return new Pool({ connectionString, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 20_000 });
}

export function createDb(connectionString: string) {
  const pool = createPool(connectionString);
  return { pool, db: drizzle(pool, { schema }) };
}

/**
 * Runs `fn` as one signed-in owner. Row-level security looks at `app.owner_id`, which is set for
 * this transaction only (the `true` makes it local), so it can never leak to another request
 * that reuses the same pooled connection.
 */
export async function asOwner<T>(db: Db, ownerId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.owner_id', ${ownerId}, true)`);
    return fn(tx);
  });
}
