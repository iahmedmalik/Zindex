import { Router } from "express";
import type { AppContext } from "../app";
import { requireUser } from "./require-user";
import { storesRouter } from "./stores";

// Everything under /v1 except sign-in needs a signed-in owner.
export function createRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(requireUser(ctx.auth));
  router.get("/me", (req, res) => res.json({ user: req.user }));
  router.use("/stores", storesRouter(ctx.db));
  return router;
}
