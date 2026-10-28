import { toNodeHandler } from "better-auth/node";
import express, { type ErrorRequestHandler, type Express } from "express";
import type { Auth } from "./auth";
import type { Config } from "./config";
import type { Db } from "./db/client";
import { HttpError } from "./http-error";
import { publicCardRouter } from "./routes/cards";
import { demoRouter } from "./routes/demo";
import { createRoutes } from "./routes";

// Everything the real server hands to the app. Tests can build the app without it (health check only)
// or with a real local database.
export type AppContext = {
  config: Config;
  db: Db;
  auth: Auth;
  /** Stand-in for outside calls (Shopify) in tests. */
  fetch?: typeof fetch;
};

export function createApp(ctx?: AppContext): Express {
  const app = express();
  app.disable("x-powered-by");
  // Render sits behind a proxy: trust one hop so the client address is the real one.
  app.set("trust proxy", 1);

  // Sign-in must be mounted before the JSON parser: Better Auth reads the raw request itself.
  if (ctx) app.all("/v1/auth/*splat", toNodeHandler(ctx.auth));

  app.use(express.json({ limit: "16kb" }));

  // The pinger calls this every 10 minutes to keep the free Render service awake.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // The delivery card is opened by customers without an account, so it sits before the sign-in check.
  if (ctx) app.use("/v1/public/card", publicCardRouter(ctx.db));
  // "Try the demo" signs the demo owner in itself, so it also sits before the sign-in check.
  if (ctx) app.use("/v1/demo", demoRouter(ctx));
  if (ctx) app.use("/v1", createRoutes(ctx));

  app.use((_req, _res, next) => next(new HttpError(404, "Not found.")));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // A body that is not valid JSON or is too large is the client's mistake, not ours.
    if (typeof err?.status === "number" && err.status >= 400 && err.status < 500) {
      res.status(err.status).json({ error: "The request could not be read." });
      return;
    }
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Something went wrong on our side." });
  };
  app.use(onError);

  return app;
}
