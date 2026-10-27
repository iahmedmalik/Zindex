import { Router } from "express";
import type { AppContext } from "../app";
import { customersRouter } from "./customers";
import { deliveriesRouter } from "./deliveries";
import { invoicesRouter, orderInvoiceRouter } from "./invoices";
import { ordersRouter } from "./orders";
import { productsRouter } from "./products";
import { requireUser } from "./require-user";
import { stockRouter } from "./stock";
import { storesRouter } from "./stores";

// Everything under /v1 except sign-in needs a signed-in owner.
export function createRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(requireUser(ctx.auth));
  router.get("/me", (req, res) => res.json({ user: req.user }));
  router.use("/stores", storesRouter(ctx.db));
  router.use("/stores/:storeId/products", productsRouter(ctx.db));
  router.use("/stores/:storeId/customers", customersRouter(ctx.db));
  router.use("/stores/:storeId/orders", ordersRouter(ctx.db));
  router.use("/stores/:storeId/orders/:orderId/invoice", orderInvoiceRouter(ctx.db));
  router.use("/stores/:storeId/orders/:orderId/delivery", deliveriesRouter(ctx.db));
  router.use("/stores/:storeId/invoices", invoicesRouter(ctx.db));
  router.use("/stores/:storeId/stock", stockRouter(ctx.db));
  return router;
}
