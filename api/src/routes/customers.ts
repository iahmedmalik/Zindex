import { sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { asOwner, type Db } from "../db/client";
import { pgCode, rows, textArray } from "../db/query";
import { HttpError } from "../http-error";
import { normalisePhone } from "../phone";
import { validateBody } from "../validate";
import { idParam, storeIdOf } from "./ids";

const phone = z
  .string()
  .trim()
  .transform(normalisePhone)
  .refine((p) => /^[0-9]{7,15}$/.test(p), "enter a phone number with 7 to 15 digits");

const address = z.string().trim().min(1).max(300);

const createBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone,
    addresses: z.array(address).max(10).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
const updateBody = createBody.partial().strict();

const returning = sql`id, store_id, name, phone, addresses, notes, created_at`;
// Repeat customers are the ones with more than one order.
const withCount = sql`id, store_id, name, phone, addresses, notes, created_at, (select count(*)::int from orders o where o.customer_id = customers.id) as order_count`;

export type Customer = { id: string; storeId: string; name: string; phone: string; addresses: string[]; notes: string | null; createdAt: Date; orderCount?: number };

// Mounted at /v1/stores/:storeId/customers
export function customersRouter(db: Db): Router {
  const router = Router({ mergeParams: true });

  router.get("/", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const digits = normalisePhone(q);
    const list = await asOwner(db, req.user!.id, (tx) =>
      rows<Customer>(
        tx,
        sql`select ${withCount} from customers
            where store_id = ${storeIdOf(req)}
              and (${q} = '' or name ilike ${"%" + q + "%"} or (${digits} <> '' and phone like ${"%" + digits + "%"}))
            order by lower(name) limit 100`,
      ),
    );
    res.json({ customers: list });
  });

  router.get("/:id", async (req, res) => {
    const [customer] = await asOwner(db, req.user!.id, (tx) =>
      rows<Customer>(tx, sql`select ${withCount} from customers where id = ${idParam(req, "id", "Customer")} and store_id = ${storeIdOf(req)}`),
    );
    if (!customer) throw new HttpError(404, "Customer not found.");
    res.json({ customer });
  });

  // Saving a customer who already exists (same phone in this store) updates that customer
  // instead of failing, so entering an order from WhatsApp never needs a "does he exist?" step.
  router.post("/", validateBody(createBody), async (req, res) => {
    const b = req.body as z.infer<typeof createBody>;
    try {
      const [customer] = await asOwner(db, req.user!.id, (tx) =>
        rows<Customer & { inserted: boolean }>(
          tx,
          sql`insert into customers (store_id, name, phone, addresses, notes)
              values (${storeIdOf(req)}, ${b.name}, ${b.phone}, ${textArray(b.addresses ?? [])}, ${b.notes ?? null})
              on conflict (store_id, phone) do update set
                name = excluded.name,
                addresses = (select coalesce(array_agg(distinct a), '{}') from unnest(customers.addresses || excluded.addresses) a),
                notes = coalesce(excluded.notes, customers.notes),
                updated_at = now()
              returning ${returning}, (xmax = 0) as inserted`,
        ),
      );
      res.status(customer!.inserted ? 201 : 200).json({ customer });
    } catch (err) {
      if (pgCode(err) === "42501" || pgCode(err) === "23503") throw new HttpError(404, "Store not found.");
      throw err;
    }
  });

  router.patch("/:id", validateBody(updateBody), async (req, res) => {
    const b = req.body as z.infer<typeof updateBody>;
    try {
      const [customer] = await asOwner(db, req.user!.id, (tx) =>
        rows<Customer>(
          tx,
          sql`update customers set
                name = coalesce(${b.name ?? null}, name),
                phone = coalesce(${b.phone ?? null}, phone),
                addresses = case when ${b.addresses !== undefined} then ${textArray(b.addresses ?? [])} else addresses end,
                notes = case when ${"notes" in b} then ${b.notes ?? null} else notes end,
                updated_at = now()
              where id = ${idParam(req, "id", "Customer")} and store_id = ${storeIdOf(req)} returning ${returning}`,
        ),
      );
      if (!customer) throw new HttpError(404, "Customer not found.");
      res.json({ customer });
    } catch (err) {
      if (pgCode(err) === "23505") throw new HttpError(409, "Another customer in this store already has that phone number.");
      throw err;
    }
  });

  router.delete("/:id", async (req, res) => {
    const gone = await asOwner(db, req.user!.id, (tx) =>
      rows<{ id: string }>(tx, sql`delete from customers where id = ${idParam(req, "id", "Customer")} and store_id = ${storeIdOf(req)} returning id`),
    );
    if (gone.length === 0) throw new HttpError(404, "Customer not found.");
    res.status(204).end();
  });

  return router;
}
