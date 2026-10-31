// Turns what the owner types into the shop's real Shopify address, and fetches public pages safely.
//
// Shopify's Admin API only answers on a shop's own *.myshopify.com address, but shops usually sell on a custom domain
// (sheenperfumes.com). Every Shopify storefront publishes /meta.json, which names its myshopify_domain, so the owner can
// type either one. Because the server fetches an address a person typed, it never goes to a private network address:
// the name must be a public host, every address it resolves to must be public, and every redirect is checked again.

import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import { ShopifyError, type ShopifyProduct } from "./products";

type Fetch = typeof fetch;
export type Lookup = (host: string) => Promise<string[]>;

const MYSHOPIFY = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export const systemLookup: Lookup = async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address);

/** What the owner typed (a web address, a link, or a .myshopify.com address) as a plain lower-case host name. */
export function parseShopInput(raw: string): string {
  let text = raw.trim().toLowerCase();
  if (!text) throw new ShopifyError("Type the shop's web address, like sheenperfumes.com.");
  if (text.includes("://")) {
    let url: URL;
    try { url = new URL(text); } catch { throw new ShopifyError("That does not look like a web address."); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new ShopifyError("Use the shop's web address, like sheenperfumes.com.");
    text = url.host;
  }
  text = text.replace(/\/.*$/, ""); // anything after the host is ignored
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(text) || net.isIP(text)) throw new ShopifyError("Type the shop's web address, like sheenperfumes.com.");
  return text;
}

const isPrivate = (ip: string): boolean => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivate(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80") || v6.startsWith("ff");
};

async function assertPublic(host: string, look: Lookup): Promise<void> {
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) throw new ShopifyError("That address cannot be used.");
  let addresses: string[];
  try { addresses = await look(host); } catch { throw new ShopifyError("Could not find that web address. Check the spelling."); }
  if (addresses.length === 0 || addresses.some(isPrivate)) throw new ShopifyError("That address cannot be used.");
}

/** GET a https page of a public host, following at most 3 redirects and checking each hop. Reads at most 2 MB. */
export async function safeGet(url: string, f: Fetch, look: Lookup = systemLookup): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(current);
    if (u.protocol !== "https:") throw new ShopifyError("Only https addresses can be used.");
    await assertPublic(u.hostname, look);
    const res = await f(current, { redirect: "manual", headers: { Accept: "application/json", "User-Agent": "Zindex/1.0" }, signal: AbortSignal.timeout(15_000) });
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get("location");
      if (!to) throw new ShopifyError("Shopify sent a redirect with nowhere to go.");
      current = new URL(to, current).toString();
      continue;
    }
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > 2_000_000) throw new ShopifyError("That page is too big to read.");
    return res;
  }
  throw new ShopifyError("Too many redirects.");
}

/** The shop's *.myshopify.com address: as typed if it already is one, otherwise read from the shop's public /meta.json. */
export async function resolveMyshopify(raw: string, f: Fetch, look: Lookup = systemLookup): Promise<string> {
  const host = parseShopInput(raw);
  if (host.endsWith(".myshopify.com")) {
    if (!MYSHOPIFY.test(host)) throw new ShopifyError("Use the shop's address, like your-shop.myshopify.com, or its web address.");
    return host;
  }
  let res: Response;
  try {
    res = await safeGet(`https://${host}/meta.json`, f, look);
  } catch (err) {
    if (err instanceof ShopifyError) throw err;
    throw new ShopifyError("Could not reach that web address. Check the spelling and try again.");
  }
  const notShopify = new ShopifyError("That address does not look like a Shopify shop.");
  if (!res.ok) throw notShopify;
  let body: { myshopify_domain?: unknown };
  try { body = (await res.json()) as typeof body; } catch { throw notShopify; }
  const found = typeof body.myshopify_domain === "string" ? body.myshopify_domain.toLowerCase() : "";
  if (!MYSHOPIFY.test(found)) throw notShopify;
  return found;
}

type PublicProduct = { id: number; title: string; images?: { src: string }[]; variants?: { price?: string }[] };

/**
 * Every published product, read from the shop's public /products.json (no app keys needed). It gives the same fields as the
 * Admin API read (name, first variant's price in whole rupees, first picture) and the same product id format, so a shop
 * that later gets keys does not end up with duplicates. Unpublished and archived products are not in this list.
 * Stops at 5,000 products.
 */
export async function fetchPublicProducts(shop: string, f: Fetch, look: Lookup = systemLookup): Promise<ShopifyProduct[]> {
  const out: ShopifyProduct[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await safeGet(`https://${shop}/products.json?limit=250&page=${page}`, f, look);
    if (!res.ok) throw new ShopifyError(res.status === 401 || res.status === 403 ? "This shop's store is password protected, so its products cannot be read." : `Shopify answered ${res.status} while reading products.`);
    let body: { products?: PublicProduct[] };
    try { body = (await res.json()) as typeof body; } catch { throw new ShopifyError("Shopify did not send a product list."); }
    const list = body.products ?? [];
    for (const p of list) {
      const price = Number(p.variants?.[0]?.price ?? "0");
      out.push({ shopifyId: `gid://shopify/Product/${p.id}`, name: String(p.title).slice(0, 120), price: Number.isFinite(price) ? Math.max(0, Math.round(price)) : 0, imageUrl: p.images?.[0]?.src ?? null, active: true });
    }
    if (list.length < 250) break;
  }
  return out;
}
