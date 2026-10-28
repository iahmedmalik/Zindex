import { sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { asOwner, type Db, type Tx } from "../db/client";
import { rows } from "../db/query";
import { HttpError } from "../http-error";
import { validateBody } from "../validate";
import { storeIdOf } from "./ids";

// "Costs to fill in": the sold lines that have no cost, grouped by product (or by typed name), with what they sold for.
// Profit leaves these lines out; filling a cost here is the only way an old line gets one, and it only ever fills a line
// that has none. A product's cost changing never reaches back into old sales (see 018_item_costs.sql).

const fillBody = z
  .object({ productId: z.uuid().optional(), name: z.string().trim().min(1).max(120).optional(), unitCost: z.number().int().min(0).max(100_000_000) })
  .strict()
  .refine((b) => b.productId !== undefined || b.name !== undefined, "say which product, or which typed item name");

async function mustHaveStore(tx: Tx, storeId: string) {
  const [s] = await rows<{ id: string }>(tx, sql`select id from stores where id = ${storeId}`);
  if (!s) throw new HttpError(404, "Store not found.");
}

// Mounted at /v1/stores/:storeId/missing-costs
export function costsRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const storeId = storeIdOf(req);
    const groups = await asOwner(db, req.user!.id, async (tx) => {
      await mustHaveStore(tx, storeId);
      return rows<{ productId: string | null; name: string; lines: number; units: number; sales: number; lastSold: Date; currentCost: number | null }>(
        tx,
        sql`select i.product_id, max(i.name) as name, count(*)::int as lines, sum(i.quantity)::int as units,
                   coalesce(round(sum(i.quantity * i.unit_price * (o.subtotal - o.discount)::numeric / nullif(o.subtotal, 0))), 0)::int as sales,
                   max(o.created_at) as last_sold, max(p.cost) as current_cost
              from order_items i
              join orders o on o.id = i.order_id
              left join products p on p.id = i.product_id
             where o.store_id = ${storeId} and o.status not in ('cancelled', 'returned') and i.unit_cost is null
             group by i.product_id, case when i.product_id is null then i.name end
             order by sales desc, name`,
      );
    });
    res.json({ groups });
  });

  // Sets the cost on the lines of one product (or one typed name) that have no cost. Lines that have a cost are never touched.
  router.post("/fill", validateBody(fillBody), async (req, res) => {
    const b = req.body as z.infer<typeof fillBody>;
    const storeId = storeIdOf(req);
    const updated = await asOwner(db, req.user!.id, async (tx) => {
      await mustHaveStore(tx, storeId);
      const done = await rows<{ id: string }>(
        tx,
        sql`update order_items set unit_cost = ${b.unitCost}
             where unit_cost is null
               and order_id in (select id from orders where store_id = ${storeId})
               and (case when ${b.productId ?? null}::uuid is not null then product_id = ${b.productId ?? null}::uuid
                         else product_id is null and name = ${b.name ?? ""} end)
         returning id`,
      );
      return done.length;
    });
    res.json({ updated });
  });

  return router;
}
