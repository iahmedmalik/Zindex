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
const app = createApp({ config, db, auth: createAuth(db, config, mailer), fetch: fakeFetch });
afterAll(() => pool.end());

describe("Shopify keys", () => {
  it("reads the app keys from the environment and ignores anything malformed", () => {
    expect(parseApps(undefined)).toEqual({});
    expect(parseApps("not json")).toEqual({});
    expect(parseApps('{"a.myshopify.com":{"clientId":"x"}}')).toEqual({});
    expect(Object.keys(parseApps(config.SHOPIFY_APPS))).toEqual([SHOP]);
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
    expect((await call("put", `/v1/stores/${store}/shopify`, { domain: "Sheen-Perfumes.myshopify.com" })).body).toEqual({ domain: SHOP, connected: true });

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
    await call("put", `/v1/stores/${store}/shopify`, { domain: "other-shop.myshopify.com" });
    const noKeys = await call("post", `/v1/stores/${store}/shopify/sync`);
    expect(noKeys.status).toBe(409);
    expect(noKeys.body.error).toMatch(/not connected/);

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
