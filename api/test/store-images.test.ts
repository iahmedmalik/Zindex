import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

// A real 48x48 PNG, so the bytes are a real picture.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAZUlEQVR4nO3PMQ0AIADAMHxwogv/MkAER0OyY3839lzn54YGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ1oQAMa0IAGNKABDWhAAxrQgAY0oAENaEADGtCABjSgAQ1oQAMa8NoFrZxq00AUJEYAAAAASUVORK5CYII=", "base64");

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "put" | "delete" | "patch", path: string) => request(t.app)[method](path).set("Cookie", cookie);
  return {
    store: async () => (await call("post", "/v1/stores").send({ name: newId("Store"), phone: "0300 0000000" })).body.store.id as string,
    put: (s: string, kind: string, bytes: Buffer = png, type = "image/png") => call("put", `/v1/stores/${s}/images/${kind}`).set("Content-Type", type).send(bytes),
    get: (s: string, kind: string) => call("get", `/v1/stores/${s}/images/${kind}`),
    del: (s: string, kind: string) => call("delete", `/v1/stores/${s}/images/${kind}`),
    list: async () => (await call("get", "/v1/stores")).body.stores as { id: string; logoUrl: string | null; watermarkUrl: string | null; watermarkOn: boolean }[],
    watermark: (s: string, on: boolean) => call("patch", `/v1/stores/${s}`).send({ watermarkOn: on }),
    order: async (s: string) =>
      (await call("post", `/v1/stores/${s}/orders`).send({ customerName: "Ayesha", customerPhone: "03001234567", address: "House 4", payment: "cod", riderFee: 350, items: [{ name: "Garam masala", quantity: 2, unitPrice: 450 }] })).body.order.id as string,
    confirm: (s: string, o: string) => call("post", `/v1/stores/${s}/orders/${o}/status`).send({ status: "confirmed" }),
    card: async (s: string, o: string) => ((await call("get", `/v1/stores/${s}/orders/${o}/card`)).body.card.url as string).split("/c/")[1]!,
  };
};

const open = (token: string) => request(t.app).get(`/v1/public/card/${token}`);
const picture = (token: string, kind: string) => request(t.app).get(`/v1/public/card/${token}/store-image/${kind}`);

describe("store logo and watermark", () => {
  it("saves a logo and a watermark, lists their addresses, serves the bytes to the owner and removes them", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    expect((await a.list())[0]).toMatchObject({ logoUrl: null, watermarkUrl: null, watermarkOn: true });

    const saved = await a.put(store, "logo");
    expect(saved.status).toBe(200);
    expect(saved.body.store.logoUrl).toMatch(new RegExp(`^/backend/v1/stores/${store}/images/logo\\?v=\\d+$`));
    expect(saved.body.store.watermarkUrl).toBeNull();
    await a.put(store, "watermark", png, "image/png");

    const got = await a.get(store, "logo");
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(got.body as Buffer, png)).toBe(0);

    const removed = await a.del(store, "logo");
    expect(removed.body.store.logoUrl).toBeNull();
    expect((await a.get(store, "logo")).status).toBe(404);
    expect((await a.list())[0]!.watermarkUrl).not.toBeNull(); // the other picture is untouched
  });

  it("refuses a picture that is too big, not a picture, or for an unknown kind", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    expect((await a.put(store, "logo", Buffer.alloc(310_000, 1))).status).toBe(413);
    expect((await a.put(store, "logo", Buffer.from("not a picture"), "text/plain")).status).toBe(400);
    expect((await a.put(store, "banner")).status).toBe(404);
    expect((await a.list())[0]!.logoUrl).toBeNull();
  });

  it("is private to the owner", async () => {
    const x = await newVerifiedOwner(t.app, t.mailer);
    const y = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(x.cookie).store();
    await api(x.cookie).put(store, "logo");
    expect((await api(y.cookie).get(store, "logo")).status).toBe(404);
    expect((await api(y.cookie).put(store, "logo")).status).toBe(404);
    expect((await api(y.cookie).del(store, "logo")).status).toBe(404);
    expect((await request(t.app).get(`/v1/stores/${store}/images/logo`)).status).toBe(401);
  });

  it("reaches the customer's card only through a valid link, and the watermark switch hides the watermark", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    await a.put(store, "logo");
    await a.put(store, "watermark");
    const order = await a.order(store);
    await a.confirm(store, order);
    const token = await a.card(store, order);

    const card = (await open(token)).body.card;
    expect(card.store).toMatchObject({ hasLogo: true, hasWatermark: true });
    expect((await picture(token, "logo")).status).toBe(200);
    expect((await picture(token, "watermark")).status).toBe(200);

    await a.watermark(store, false);
    expect((await open(token)).body.card.store).toMatchObject({ hasLogo: true, hasWatermark: false });
    expect((await picture(token, "watermark")).status).toBe(404);
    expect((await a.list())[0]).toMatchObject({ watermarkOn: false });
    expect((await a.get(store, "watermark")).status).toBe(200); // the owner keeps the picture, only the switch is off

    expect((await picture("A".repeat(32), "logo")).status).toBe(404); // a link that does not exist
    expect((await picture(token, "banner")).status).toBe(404);
  });

  it("goes with the store when the store is deleted", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(o.cookie).store();
    await api(o.cookie).put(store, "logo");
    expect((await request(t.app).delete(`/v1/stores/${store}`).set("Cookie", o.cookie)).status).toBe(204);
    expect((await api(o.cookie).get(store, "logo")).status).toBe(404);
  });
});
