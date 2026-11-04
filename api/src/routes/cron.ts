import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { AppContext } from "../app";
import { HttpError } from "../http-error";
import { purgeDeliveryPhotos } from "../maintenance";
import { clearOldCounters } from "../rate-limit";
import { ensureDemo } from "./demo";

const sameSecret = (given: string, wanted: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(wanted);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * The daily jobs for hosts that cannot keep timers (Vercel). The scheduler sends `Authorization: Bearer <CRON_SECRET>`.
 * Without CRON_SECRET the route does not exist, so a server that does not use it exposes nothing.
 */
export function cronRouter(ctx: AppContext): Router {
  const router = Router();
  router.get("/daily", async (req, res) => {
    const secret = ctx.config.CRON_SECRET;
    if (!secret) throw new HttpError(404, "Not found.");
    if (!sameSecret(req.headers.authorization ?? "", `Bearer ${secret}`)) throw new HttpError(401, "Not allowed.");

    const removedPhotos = await purgeDeliveryPhotos(ctx.db);
    await clearOldCounters(ctx.db);
    const demoOn = Boolean(ctx.config.DEMO_EMAIL && ctx.config.DEMO_PASSWORD && ctx.config.API_PUBLIC_URL);
    if (demoOn) await ensureDemo(ctx, ctx.config.API_PUBLIC_URL!);
    res.json({ removedPhotos, demo: demoOn ? "refreshed" : "off" });
  });
  return router;
}
