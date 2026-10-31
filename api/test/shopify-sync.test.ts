import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createDb } from "../src/db/client";
import { memoryMailer } from "../src/mailer";
import { parseApps } from "../src/shopify/products";
import { newId, newVerifiedOwner, testConfig, urls } from "./helpers";

// A pretend Shopify: answers the token request and two pages of products, and records what it was asked.
const SHOP = "sheen-perfumes.myshopify.com";
let shopifyDown = false;
const calls: string[] = [];
const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  calls.push(url);
  if (shopifyDown) return new Response("busy", { status: 503 });
  if (url === "https://sheenperfumes.test/meta.json") return Response.json({ name: "Sheen Perfumes", domain: "sheenperfumes.test", myshopify_domain: SHOP });
  if (url === "https://notshopify.test/meta.json") return new Response("<html>hello</html>", { status: 200 });
  if (url === "https://redirecting.test/meta.json") return new Response(null, { status: 302, headers: { location: "https://internal.test/meta.json" } });
  if (url.startsWith("https://public-shop.myshopify.com/products.json")) {
    const page = Number(new URL(url).searchParams.get("page"));
    const item = (id: number, title: string, price: string) => ({ id, title, images: [{ src: `https://cdn.shopify.com/p${id}.jpg` }], variants: [{ price }] });
    return Response.json({ products: page === 1 ? [item(11, "Rose Oud 50 ml", "4200.00"), item(12, "Amber Attar", "950.50")] : [] });
  }
  if (url.endsWith("/admin/oauth/access_token")) {
    const body = new URLSearchParams(String(init?.body));
    if (body.get("grant_type") !== "client_credentials" || body.get("client_secret") !== "secret-1") return new Response("{}", { status: 401 });
    return Response.json({ access_token: "token-abc", expires_in: 86399 });
  }
  if (url.includes("/graphql.json")) {
    if ((init?.headers as Record<string, string>)["X-Shopify-Access-Token"] !== "token-abc") return new Response("{}", { status: 401 });
    const after = JSON.parse(String(init?.body)).variables.after;
    const node = (id: number, title: string, price: string, status = "ACTIVE") => ({ id: `gid://shopify/Product/${id}`, title, status, featuredImage: { url: `https://cdn.shopify.com/${id}.jpg` }, variants: { nodes: [{ price }] } });
    return Response.json(after === null
      ? { data: { products: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [node(1, "Oud Royale 50 ml", "6500.00"), node(2, "White Musk 30 ml", "3199.50")] } } }
      : { data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(3, "Old Attar", "900.00", "ARCHIVED")] } } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const config = { ...testConfig, SHOPIFY_APPS: JSON.stringify({ [SHOP]: { clientId: "id-1", clientSecret: "secret-1" } }) };
const { db, pool } = createDb(urls.app());
const mailer = memoryMailer();
// The pretend DNS: every name is public except the one named "internal.test", which points at a private address.
const lookup = async (host: string) => (host === "internal.test" ? ["10.0.0.5"] : ["93.184.216.34"]);
const app = createApp({ config, db, auth: createAuth(db, config, mailer), fetch: fakeFetch, lookup });
afterAll(() => pool.end());

describe("Shopify keys", () => {
  it("reads the app keys from the environment and ignores anything malformed", () => {
    expect(parseApps(undefined)).toEqual({});
    expect(parseApps("not json")).toEqual({});
    expect(parseApps('{"a.myshopify.com":{"clientId":"x"}}')).toEqual({});
    expect(Object.keys(parseApps(config.SHOPIFY_APPS))).toEqual([SHOP]);
  });
});

describe("a shop on its own web address", () => {
  const setup = async () => {
    const o = await newVerifiedOwner(app, mailer);
    const call = (method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](path).set("Cookie", o.cookie).send(body);
    const store = (await call("post", "/v1/stores", { name: newId("S") })).body.store.id as string;
    return { call, store };
  };

  it("takes the shop's web address, a link or the .myshopify.com address, and saves the real .myshopify.com address", async () => {
    const { call, store } = await setup();
    for (const typed of ["sheenperfumes.test", "SheenPerfumes.test", "https://sheenperfumes.test/", "https://sheenperfumes.test/collections/all?x=1", "sheenperfumes.test/products"]) {
      const saved = await call("put", `/v1/stores/${store}/shopify`, { domain: typed });
      expect(saved.status, typed).toBe(200);
      expect(saved.body).toEqual({ domain: SHOP, connected: true, mode: "keys" });
    }
    expect((await call("get", `/v1/stores/${store}/shopify`)).body.domain).toBe(SHOP);
    expect((await call("put", `/v1/stores/${store}/shopify`, { domain: null })).body).toEqual({ domain: null, connected: false, mode: null });
  });

  it("says so when the address is not a Shopify shop, or is not an address at all", async () => {
    const { call, store } = await setup();
    const notShop = await call("put", `/v1/stores/${store}/shopify`, { domain: "notshopify.test" });
    expect(notShop.status).toBe(400);
    expect(notShop.body.error).toMatch(/does not look like a Shopify shop/);
    for (const bad of ["not a shop", "ftp://x.test", "-bad.test", "justaword", "a..b.test"]) expect((await call("put", `/v1/stores/${store}/shopify`, { domain: bad })).status, bad).toBe(400);
  });

  it("never goes to a private address: not an IP, not localhost, not a name that points inside, not a redirect there", async () => {
    const { call, store } = await setup();
    const before = calls.length;
    for (const typed of ["http://127.0.0.1", "169.254.169.254", "localhost", "https://10.0.0.1/", "internal.test", "redirecting.test"]) {
      const res = await call("put", `/v1/stores/${store}/shopify`, { domain: typed });
      expect(res.status, typed).toBe(400);
    }
    expect(calls.slice(before).filter((u) => u.includes("internal.test") || u.includes("127.0.0.1") || u.includes("169.254"))).toEqual([]);
  });

  it("reads the public product list when the server has no keys for the shop, and links the same products later", async () => {
    const { call, store } = await setup();
    await call("post", `/v1/stores/${store}/products`, { name: "amber attar", price: 900, cost: 500 });
    const saved = await call("put", `/v1/stores/${store}/shopify`, { domain: "public-shop.myshopify.com" });
    expect(saved.body).toEqual({ domain: "public-shop.myshopify.com", connected: true, mode: "public" });
    const sync = await call("post", `/v1/stores/${store}/shopify/sync`);
    expect(sync.status).toBe(200);
    expect(sync.body).toMatchObject({ added: 1, linked: 1, updated: 0, total: 2 });
    const products = (await call("get", `/v1/stores/${store}/products`)).body.products;
    const byName = Object.fromEntries(products.map((p: { name: string }) => [p.name, p]));
    expect(byName["Rose Oud 50 ml"]).toMatchObject({ price: 4200, imageUrl: "https://cdn.shopify.com/p11.jpg", active: true });
    expect(byName["amber attar"]).toMatchObject({ price: 951, cost: 500 }); // linked by name, price rounded, cost kept
    expect((await call("post", `/v1/stores/${store}/shopify/sync`)).body).toMatchObject({ added: 0, updated: 2 });
  });

  it("explains a shop whose product list cannot be read, and changes nothing", async () => {
    const { call, store } = await setup();
    await call("put", `/v1/stores/${store}/shopify`, { domain: "other-shop.myshopify.com" }); // the fake shop has no list for it
    const res = await call("post", `/v1/stores/${store}/shopify/sync`);
    expect(res.status).toBe(502);
    expect((await call("get", `/v1/stores/${store}/products`)).body.products).toHaveLength(0);
  });
});

describe("Shopify product sync", () => {
  it("adds new products, links a product with the same name, updates on the next sync and never touches stock", async () => {
    const o = await newVerifiedOwner(app, mailer);
    const call = (method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](path).set("Cookie", o.cookie).send(body);
    const store = (await call("post", "/v1/stores", { name: "Sheen Perfumes" })).body.store.id;
    const musk = (await call("post", `/v1/stores/${store}/products`, { name: "white musk 30 ml", price: 3000, cost: 1900 })).body.product.id;
    await call("post", `/v1/stores/${store}/stock/adjust`, { productId: musk, delta: 7 });

    expect((await call("post", `/v1/stores/${store}/shopify/sync`)).status).toBe(409); // no shop yet
    expect((await call("put", `/v1/stores/${store}/shopify`, { domain: "not a shop" })).status).toBe(400);
    expect((await call("put", `/v1/stores/${store}/shopify`, { domain: "Sheen-Perfumes.myshopify.com" })).body).toEqual({ domain: SHOP, connected: true, mode: "keys" });

    const first = await call("post", `/v1/stores/${store}/shopify/sync`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ added: 2, linked: 1, updated: 0, total: 3 });

    const products = (await call("get", `/v1/stores/${store}/products`)).body.products;
    const byName = Object.fromEntries(products.map((p: { name: string }) => [p.name, p]));
    expect(byName["Oud Royale 50 ml"]).toMatchObject({ price: 6500, imageUrl: "https://cdn.shopify.com/1.jpg", active: true });
    expect(byName["white musk 30 ml"]).toMatchObject({ id: musk, price: 3200, cost: 1900 }); // linked, price rounded, cost kept
    expect(byName["Old Attar"]).toMatchObject({ active: false });
    expect((await call("get", `/v1/stores/${store}/stock`)).body.stock.find((s: { productId: string }) => s.productId === musk).onHand).toBe(7);

    const second = await call("post", `/v1/stores/${store}/shopify/sync`);
    expect(second.body).toMatchObject({ added: 0, linked: 0, updated: 3 });
    expect((await call("get", `/v1/stores/${store}/shopify`)).body.lastSync).toBeTruthy();
  });

  it("explains a missing key or Shopify being down, and changes nothing", async () => {
    const o = await newVerifiedOwner(app, mailer);
    const call = (method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](path).set("Cookie", o.cookie).send(body);
    const store = (await call("post", "/v1/stores", { name: newId("S") })).body.store.id;
    await call("put", `/v1/stores/${store}/shopify`, { domain: SHOP });
    shopifyDown = true;
    const down = await call("post", `/v1/stores/${store}/shopify/sync`);
    shopifyDown = false;
    expect(down.status).toBe(502);
    expect((await call("get", `/v1/stores/${store}/products`)).body.products).toHaveLength(0);
  });

  it("keeps other owners out", async () => {
    const a = await newVerifiedOwner(app, mailer);
    const b = await newVerifiedOwner(app, mailer);
    const store = (await request(app).post("/v1/stores").set("Cookie", a.cookie).send({ name: newId("S") })).body.store.id;
    expect((await request(app).put(`/v1/stores/${store}/shopify`).set("Cookie", b.cookie).send({ domain: SHOP })).status).toBe(404);
    expect((await request(app).post(`/v1/stores/${store}/shopify/sync`).set("Cookie", b.cookie)).status).toBe(404);
  });
});
