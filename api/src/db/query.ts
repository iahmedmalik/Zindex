import type { SQL } from "drizzle-orm";
import type { Tx } from "./client";

const camelKey = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

// Postgres returns snake_case columns; the API speaks camelCase. Dates and numbers pass through.
export function camel<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camelKey(k), v])) as T;
}

/** Runs a hand-written query inside the owner's transaction and returns camelCased rows. */
export async function rows<T>(tx: Tx, query: SQL): Promise<T[]> {
  const result = await tx.execute(query);
  return (result.rows as Record<string, unknown>[]).map((r) => camel<T>(r));
}

/** True when a Postgres error carries one of these codes (23505 duplicate, 23503 missing parent, 23514 check). */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}
