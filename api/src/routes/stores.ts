import { and, asc, eq, sql } from "drizzle-orm";
import express, { Router, type Request } from "express";
import { z } from "zod";
import { rows } from "../db/query";
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

// On update, phone, email and address may be null, which clears them.
const updateBody = createBody
  .extend({
    phone: createBody.shape.phone.nullable(),
    email: createBody.shape.email.nullable(),
    address: createBody.shape.address.nullable(),
    watermarkOn: z.boolean(),
  })
  .partial()
  .strict();

// The public shape of a store: the invoice counter stays inside the database.
const columns = {
  id: stores.id,
  name: stores.name,
  phone: stores.phone,
  email: stores.email,
  address: stores.address,
  logoVersion: stores.logoVersion,
  watermarkVersion: stores.watermarkVersion,
  watermarkOn: stores.watermarkOn,
  accent: stores.accent,
  invoicePrefix: stores.invoicePrefix,
  createdAt: stores.createdAt,
};

type Row = { id: string; logoVersion: number | null; watermarkVersion: number | null; [k: string]: unknown };

/** The pictures are served from their own addresses; the version in the address makes the browser fetch a new one after a change. */
export const withPictures = <T extends Row>({ logoVersion, watermarkVersion, ...rest }: T) => ({
  ...rest,
  logoUrl: logoVersion ? `/backend/v1/stores/${rest.id}/images/logo?v=${logoVersion}` : null,
  watermarkUrl: watermarkVersion ? `/backend/v1/stores/${rest.id}/images/watermark?v=${watermarkVersion}` : null,
});

const idOf = (req: Request): string => {
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Store not found.");
  return id;
};

export function storesRouter(db: Db): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const rows = await asOwner(db, req.user!.id, (tx) => tx.select(columns).from(stores).orderBy(asc(stores.createdAt)));
    res.json({ stores: rows.map(withPictures) });
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
          returning id, name, phone, email, address, logo_version as "logoVersion", watermark_version as "watermarkVersion", watermark_on as "watermarkOn", accent, invoice_prefix as "invoicePrefix", created_at as "createdAt"`),
      );
      res.status(201).json({ store: withPictures(result.rows[0] as Row) });
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
    res.json({ store: withPictures(row) });
  });

  // The store's logo and watermark: one small picture each (the app shrinks it first), kept in the database, shown on
  // the invoice, the receipt and the customer's card. Saving or removing one changes its version so pages fetch a new copy.
  const kindOf = (req: Request): "logo" | "watermark" => {
    const kind = String(req.params.kind);
    if (kind !== "logo" && kind !== "watermark") throw new HttpError(404, "There is no such picture.");
    return kind;
  };
  const pictureBody = express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "300kb" });
  router.put("/:id/images/:kind", pictureBody, async (req, res) => {
    const kind = kindOf(req);
    const type = req.headers["content-type"]?.split(";")[0];
    const bytes = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new HttpError(400, "Send the picture as a PNG, JPEG or WebP image, up to 300 KB.");
    const store = await asOwner(db, req.user!.id, async (tx) => {
      const id = idOf(req);
      const found = await rows<{ id: string }>(tx, sql`select id from stores where id = ${id}`);
      if (found.length === 0) throw new HttpError(404, "Store not found.");
      await tx.execute(
        sql`insert into store_images (store_id, kind, image, content_type) values (${id}, ${kind}, ${bytes}, ${type})
            on conflict (store_id, kind) do update set image = excluded.image, content_type = excluded.content_type, created_at = now()`,
      );
      const version = Date.now();
      await tx.update(stores).set(kind === "logo" ? { logoVersion: version } : { watermarkVersion: version }).where(eq(stores.id, id));
      return (await tx.select(columns).from(stores).where(eq(stores.id, id)))[0]!;
    });
    res.json({ store: withPictures(store) });
  });

  router.get("/:id/images/:kind", async (req, res) => {
    const kind = kindOf(req);
    const found = await asOwner(db, req.user!.id, (tx) => rows<{ image: Buffer; contentType: string }>(tx, sql`select image, content_type from store_images where store_id = ${idOf(req)} and kind = ${kind}`));
    if (!found[0]) throw new HttpError(404, "There is no such picture.");
    res.set({ "Content-Type": found[0].contentType, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" }).send(found[0].image);
  });

  router.delete("/:id/images/:kind", async (req, res) => {
    const kind = kindOf(req);
    const store = await asOwner(db, req.user!.id, async (tx) => {
      const id = idOf(req);
      await tx.execute(sql`delete from store_images where store_id = ${id} and kind = ${kind}`);
      const [row] = await tx.update(stores).set(kind === "logo" ? { logoVersion: null } : { watermarkVersion: null }).where(eq(stores.id, id)).returning(columns);
      if (!row) throw new HttpError(404, "Store not found.");
      return row;
    });
    res.json({ store: withPictures(store) });
  });

  router.delete("/:id", async (req, res) => {
    const rows = await asOwner(db, req.user!.id, (tx) => tx.delete(stores).where(eq(stores.id, idOf(req))).returning({ id: stores.id }));
    if (rows.length === 0) throw new HttpError(404, "Store not found.");
    res.status(204).end();
  });

  return router;
}
