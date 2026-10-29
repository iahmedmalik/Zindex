import { sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { asOwner, type Db } from "../db/client";
import { pgCode, rows } from "../db/query";
import { HttpError } from "../http-error";
import { validateBody } from "../validate";
import { idParam, storeIdOf } from "./ids";

const adjustBody = z
  .object({
    productId: z.uuid(),
    delta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "the change cannot be zero"),
    note: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

// Mounted at /v1/stores/:storeId/stock
export function stockRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  // One row per product with what is on hand and how many have been sold.
  router.get("/", async (req, res) => {
    const list = await asOwner(db, req.user!.id, (tx) =>
      rows(
        tx,
        sql`select p.id as product_id, p.name, p.price, p.cost,
                   coalesce(sum(m.delta), 0)::int as on_hand,
                   coalesce(-sum(m.delta) filter (where m.reason in ('sale', 'restore', 'edit')), 0)::int as units_sold
              from products p left join stock_movements m on m.product_id = p.id
             where p.store_id = ${storeIdOf(req)}
             group by p.id order by lower(p.name)`,
      ),
    );
    res.json({ stock: list });
  });

  router.get("/:productId/history", async (req, res) => {
    const list = await asOwner(db, req.user!.id, (tx) =>
      rows(
        tx,
        sql`select m.id, m.delta, m.reason, m.note, m.order_id, m.created_at, o.order_no
              from stock_movements m left join orders o on o.id = m.order_id
             where m.store_id = ${storeIdOf(req)} and m.product_id = ${idParam(req, "productId", "Product")}
             order by m.created_at desc, m.id limit 200`,
      ),
    );
    res.json({ history: list });
  });

  router.post("/adjust", validateBody(adjustBody), async (req, res) => {
    const b = req.body as z.infer<typeof adjustBody>;
    try {
      const [movement] = await asOwner(db, req.user!.id, (tx) =>
        rows(
          tx,
          sql`insert into stock_movements (store_id, product_id, delta, reason, note)
              values (${storeIdOf(req)}, ${b.productId}, ${b.delta}, 'adjustment', ${b.note ?? null})
              returning id, product_id, delta, reason, note, created_at`,
        ),
      );
      res.status(201).json({ movement });
    } catch (err) {
      if (pgCode(err) === "42501" || pgCode(err) === "23503") throw new HttpError(404, "Product not found in this store.");
      throw err;
    }
  });

  return router;
}
