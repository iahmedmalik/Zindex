import { sql } from "drizzle-orm";
import type { Db } from "./db/client";

/** Deletes rider photos whose card link is long gone (rule in sql/017). Returns how many went. */
export async function purgeDeliveryPhotos(db: Db): Promise<number> {
  const result = await db.execute(sql`select purge_delivery_photos() as removed`);
  return Number((result.rows[0] as { removed: number }).removed);
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * Runs the photo cleanup shortly after the server starts (so a wake-up on the free plan still cleans)
 * and then every 6 hours. A failure is logged and tried again later; it never stops the server.
 */
export function startPhotoCleanup(db: Db, log: (msg: string) => void = console.log): () => void {
  const run = async () => {
    try {
      const removed = await purgeDeliveryPhotos(db);
      if (removed > 0) log(`Removed ${removed} expired rider photo${removed === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error("Rider photo cleanup failed:", err);
    }
  };
  const first = setTimeout(run, 30_000);
  const every = setInterval(run, SIX_HOURS);
  first.unref();
  every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}
