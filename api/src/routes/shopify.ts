import { sql } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { asOwner, type Db } from "../db/client";
import { rows } from "../db/query";
import { HttpError } from "../http-error";
import { fetchProducts, ShopifyError, type ShopifyApp } from "../shopify/products";
import { validateBody } from "../validate";
import { storeIdOf } from "./ids";

const domainBody = z
  .object({ domain: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, "use the shop's .myshopify.com address").nullable() })
  .strict();

// Mounted at /v1/stores/:storeId/shopify
export function shopifyRouter(db: Db, apps: Record<string, ShopifyApp>, f: typeof fetch = fetch): Router {
  const router = Router({ mergeParams: true });

  const storeOf = async (ownerId: string, storeId: string) => {
    const [store] = await asOwner(db, ownerId, (tx) => rows<{ shopifyDomain: string | null; shopifySyncedAt: Date | null }>(tx, sql`select shopify_domain, shopify_synced_at from stores where id = ${storeId}`));
    if (!store) throw new HttpError(404, "Store not found.");
    return store;
  };

  // Is this store connected? (keys exist on the server for its shop)
  router.get("/", async (req, res) => {
    const store = await storeOf(req.user!.id, storeIdOf(req));
    res.json({ domain: store.shopifyDomain, connected: !!(store.shopifyDomain && apps[store.shopifyDomain]), lastSync: store.shopifySyncedAt });
  });

  router.put("/", validateBody(domainBody), async (req, res) => {
    const { domain } = req.body as z.infer<typeof domainBody>;
    const storeId = storeIdOf(req);
    await storeOf(req.user!.id, storeId);
    await asOwner(db, req.user!.id, (tx) => tx.execute(sql`update stores set shopify_domain = ${domain}, updated_at = now() where id = ${storeId}`));
    res.json({ domain, connected: !!(domain && apps[domain]) });
  });

  // Pulls names, prices and images. Products already linked are updated, a product with the same
  // name is linked, anything new is added. Stock is never touched. If Shopify fails, nothing changes.
  router.post("/sync", async (req, res) => {
    const storeId = storeIdOf(req);
    const store = await storeOf(req.user!.id, storeId);
    if (!store.shopifyDomain) throw new HttpError(409, "Add the store's Shopify address first.");
    const app = apps[store.shopifyDomain];
    if (!app) throw new HttpError(409, "Shopify is not connected for this shop yet: its app keys are not on the server.");

    let products;
    try {
      products = await fetchProducts(store.shopifyDomain, app, f);
    } catch (err) {
      if (err instanceof ShopifyError) throw new HttpError(502, err.message);
      throw new HttpError(502, "Could not reach Shopify. Try again in a minute; everything else still works.");
    }

    const counts = await asOwner(db, req.user!.id, async (tx) => {
      let added = 0, updated = 0, linked = 0, skipped = 0;
      for (const p of products) {
        const [byId] = await rows<{ id: string }>(tx, sql`select id from products where store_id = ${storeId} and shopify_product_id = ${p.shopifyId}`);
        if (byId) {
          await tx.execute(sql`update products set name = ${p.name}, price = ${p.price}, image_url = ${p.imageUrl}, active = ${p.active}, updated_at = now() where id = ${byId.id}`);
          updated++;
          continue;
        }
        const [byName] = await rows<{ id: string }>(tx, sql`select id from products where store_id = ${storeId} and lower(name) = lower(${p.name}) and shopify_product_id is null`);
        if (byName) {
          await tx.execute(sql`update products set shopify_product_id = ${p.shopifyId}, price = ${p.price}, image_url = ${p.imageUrl}, active = ${p.active}, updated_at = now() where id = ${byName.id}`);
          linked++;
          continue;
        }
        // Two Shopify products with the same title: the second is skipped (names are unique per store).
        const made = await rows(tx, sql`insert into products (store_id, name, price, active, shopify_product_id, image_url) values (${storeId}, ${p.name}, ${p.price}, ${p.active}, ${p.shopifyId}, ${p.imageUrl}) on conflict do nothing returning id`);
        if (made.length) added++;
        else skipped++;
      }
      await tx.execute(sql`update stores set shopify_synced_at = now() where id = ${storeId}`);
      return { added, updated, linked, skipped };
    });
    res.json({ ...counts, total: products.length });
  });

  return router;
}
