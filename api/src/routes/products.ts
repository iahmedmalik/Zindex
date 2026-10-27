import { sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { asOwner, type Db } from "../db/client";
import { pgCode, rows } from "../db/query";
import { HttpError } from "../http-error";
import { validateBody } from "../validate";
import { idParam, storeIdOf } from "./ids";

const money = z.number().int().min(0).max(100_000_000);

const createBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    price: money,
    cost: money.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
const updateBody = createBody.partial().strict();

const returning = sql`id, store_id, name, price, cost, active, image_url, created_at`;

type Product = { id: string; storeId: string; name: string; price: number; cost: number | null; active: boolean; imageUrl: string | null; createdAt: Date };

// Mounted at /v1/stores/:storeId/products
export function productsRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const list = await asOwner(db, req.user!.id, (tx) =>
      rows<Product>(tx, sql`select ${returning} from products where store_id = ${storeIdOf(req)} and (${q} = '' or name ilike ${"%" + q + "%"}) order by lower(name)`),
    );
    res.json({ products: list });
  });

  router.post("/", validateBody(createBody), async (req, res) => {
    const b = req.body as z.infer<typeof createBody>;
    try {
      const [product] = await asOwner(db, req.user!.id, (tx) =>
        rows<Product>(
          tx,
          sql`insert into products (store_id, name, price, cost, active)
              values (${storeIdOf(req)}, ${b.name}, ${b.price}, ${b.cost ?? null}, ${b.active ?? true}) returning ${returning}`,
        ),
      );
      res.status(201).json({ product });
    } catch (err) {
      const code = pgCode(err);
      if (code === "23505") throw new HttpError(409, "This store already has a product with that name.");
      if (code === "42501" || code === "23503") throw new HttpError(404, "Store not found.");
      throw err;
    }
  });

  router.patch("/:id", validateBody(updateBody), async (req, res) => {
    const b = req.body as z.infer<typeof updateBody>;
    try {
      const [product] = await asOwner(db, req.user!.id, (tx) =>
        rows<Product>(
          tx,
          sql`update products set
                name = coalesce(${b.name ?? null}, name),
                price = coalesce(${b.price ?? null}, price),
                cost = case when ${"cost" in b} then ${b.cost ?? null} else cost end,
                active = coalesce(${b.active ?? null}, active),
                updated_at = now()
              where id = ${idParam(req, "id", "Product")} and store_id = ${storeIdOf(req)} returning ${returning}`,
        ),
      );
      if (!product) throw new HttpError(404, "Product not found.");
      res.json({ product });
    } catch (err) {
      if (pgCode(err) === "23505") throw new HttpError(409, "This store already has a product with that name.");
      throw err;
    }
  });

  router.delete("/:id", async (req, res) => {
    const gone = await asOwner(db, req.user!.id, (tx) =>
      rows<{ id: string }>(tx, sql`delete from products where id = ${idParam(req, "id", "Product")} and store_id = ${storeIdOf(req)} returning id`),
    );
    if (gone.length === 0) throw new HttpError(404, "Product not found.");
    res.status(204).end();
  });

  return router;
}
