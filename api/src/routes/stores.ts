import { and, asc, eq, sql } from "drizzle-orm";
import { Router, type Request } from "express";
import { z } from "zod";
import { asOwner, type Db } from "../db/client";
import { stores } from "../db/schema";
import { HttpError } from "../http-error";
import { validateBody } from "../validate";

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must look like #5d1b23");
const prefix = z.string().regex(/^[A-Z0-9]{1,8}$/, "use 1 to 8 capital letters or digits");

const createBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(120).email("enter a valid email address").optional(),
    address: z.string().trim().max(300).optional(),
    accent: colour.optional(),
    invoicePrefix: prefix.optional(),
  })
  .strict();

const updateBody = createBody.partial().strict();

// The public shape of a store: the invoice counter stays inside the database.
const columns = {
  id: stores.id,
  name: stores.name,
  phone: stores.phone,
  email: stores.email,
  address: stores.address,
  logoUrl: stores.logoUrl,
  accent: stores.accent,
  invoicePrefix: stores.invoicePrefix,
  createdAt: stores.createdAt,
};

const idOf = (req: Request): string => {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Store not found.");
  return id;
};

export function storesRouter(db: Db): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const rows = await asOwner(db, req.user!.id, (tx) => tx.select(columns).from(stores).orderBy(asc(stores.createdAt)));
    res.json({ stores: rows });
  });

  router.post("/", validateBody(createBody), async (req, res) => {
    const body = req.body as z.infer<typeof createBody>;
    try {
      // Hand-written insert on purpose: the app role may only insert the columns below, and
      // Postgres refuses any insert that even names another column (such as next_invoice_no),
      // which is what a generated insert does for every column it leaves to the default.
      const given = [
        ["name", body.name],
        ["phone", body.phone],
        ["email", body.email],
        ["address", body.address],
        ["accent", body.accent],
        ["invoice_prefix", body.invoicePrefix],
      ].filter(([, value]) => value !== undefined) as [string, string][];
      const names = [sql.identifier("owner_id"), ...given.map(([n]) => sql.identifier(n))];
      const values = [sql`${req.user!.id}`, ...given.map(([, v]) => sql`${v}`)];
      const result = await asOwner(db, req.user!.id, (tx) =>
        tx.execute(sql`
          insert into stores (${sql.join(names, sql`, `)}) values (${sql.join(values, sql`, `)})
          returning id, name, phone, email, address, logo_url as "logoUrl", accent, invoice_prefix as "invoicePrefix", created_at as "createdAt"`),
      );
      res.status(201).json({ store: result.rows[0] });
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code === "23505") throw new HttpError(409, "You already have a store with that name.");
      throw err;
    }
  });

  router.patch("/:id", validateBody(updateBody), async (req, res) => {
    const body = req.body as z.infer<typeof updateBody>;
    const [row] = await asOwner(db, req.user!.id, (tx) =>
      tx
        .update(stores)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(stores.id, idOf(req))))
        .returning(columns),
    );
    if (!row) throw new HttpError(404, "Store not found.");
    res.json({ store: row });
  });

  router.delete("/:id", async (req, res) => {
    const rows = await asOwner(db, req.user!.id, (tx) => tx.delete(stores).where(eq(stores.id, idOf(req))).returning({ id: stores.id }));
    if (rows.length === 0) throw new HttpError(404, "Store not found.");
    res.status(204).end();
  });

  return router;
}
