// Reads a shop's products from Shopify (read only: the app needs only the read_products scope).
//
// Sign-in: Shopify's client-credentials grant for a Dev Dashboard app. The app's client id and
// secret are exchanged for an access token that lasts about 24 hours, so a fresh token is fetched
// for every sync and never stored. Not yet tried against the Sheen shops (to do once the app is
// installed); every call goes through `fetch` so tests can stand in for Shopify.

export type ShopifyApp = { clientId: string; clientSecret: string };
export type ShopifyProduct = { shopifyId: string; name: string; price: number; imageUrl: string | null; active: boolean };
type Fetch = typeof fetch;

export const API_VERSION = "2025-10";

export class ShopifyError extends Error {}

/** Reads SHOPIFY_APPS: a JSON object of shop domain -> { clientId, clientSecret }. Bad JSON means "none". */
export function parseApps(raw: string | undefined): Record<string, ShopifyApp> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, ShopifyApp>;
    return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v?.clientId === "string" && typeof v?.clientSecret === "string"));
  } catch {
    return {};
  }
}

async function token(shop: string, app: ShopifyApp, f: Fetch): Promise<string> {
  const res = await f(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: app.clientId, client_secret: app.clientSecret }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new ShopifyError(res.status === 401 || res.status === 400 ? "Shopify refused the app's keys. Check the client id and secret." : `Shopify sign-in failed (${res.status}).`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new ShopifyError("Shopify did not send an access token.");
  return body.access_token;
}

const QUERY = `query Products($after: String) {
  products(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id title status featuredImage { url } variants(first: 1) { nodes { price } } }
  }
}`;

type Page = {
  data?: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; title: string; status: string; featuredImage: { url: string } | null; variants: { nodes: { price: string }[] } }[] } };
  errors?: { message: string }[];
};

/** Every product in the shop, with the first variant's price in whole rupees. Stops at 5,000 products. */
export async function fetchProducts(shop: string, app: ShopifyApp, f: Fetch = fetch): Promise<ShopifyProduct[]> {
  const access = await token(shop, app, f);
  const out: ShopifyProduct[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const res = await f(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access },
      body: JSON.stringify({ query: QUERY, variables: { after } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new ShopifyError(`Shopify answered ${res.status} while reading products.`);
    const body = (await res.json()) as Page;
    if (body.errors?.length || !body.data) throw new ShopifyError(`Shopify could not list products: ${body.errors?.[0]?.message ?? "no data"}.`);
    for (const p of body.data.products.nodes) {
      const price = Number(p.variants.nodes[0]?.price ?? "0");
      out.push({ shopifyId: p.id, name: p.title.slice(0, 120), price: Number.isFinite(price) ? Math.max(0, Math.round(price)) : 0, imageUrl: p.featuredImage?.url ?? null, active: p.status === "ACTIVE" });
    }
    if (!body.data.products.pageInfo.hasNextPage) break;
    after = body.data.products.pageInfo.endCursor;
  }
  return out;
}
