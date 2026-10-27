import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

describe("backup download", () => {
  it("contains all of the owner's data and nothing of anyone else's", async () => {
    const a = await newVerifiedOwner(t.app, t.mailer);
    const b = await newVerifiedOwner(t.app, t.mailer);
    const call = (cookie: string, method: "get" | "post", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
    for (const owner of [a, b]) {
      const store = (await call(owner.cookie, "post", "/v1/stores", { name: newId("Store") })).body.store.id;
      const product = (await call(owner.cookie, "post", `/v1/stores/${store}/products`, { name: "Spice", price: 100 })).body.product.id;
      await call(owner.cookie, "post", `/v1/stores/${store}/stock/adjust`, { productId: product, delta: 5 });
      const order = (await call(owner.cookie, "post", `/v1/stores/${store}/orders`, { customerName: "Buyer", customerPhone: "03001234567", items: [{ productId: product, quantity: 2 }] })).body.order.id;
      await call(owner.cookie, "post", `/v1/stores/${store}/orders/${order}/invoice`);
      await call(owner.cookie, "post", `/v1/stores/${store}/orders/${order}/card`, {});
    }

    const res = await call(a.cookie, "get", "/v1/backup");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="zindex-backup-\d{4}-\d{2}-\d{2}\.json"/);
    const { data, owner, format } = res.body;
    expect(format).toBe("zindex-backup");
    expect(owner.id).toBe(a.id);
    expect(data.stores).toHaveLength(1);
    expect(data.products).toHaveLength(1);
    expect(data.customers).toHaveLength(1);
    expect(data.orders).toHaveLength(1);
    expect(data.orderItems).toHaveLength(1);
    expect(data.invoices).toHaveLength(1);
    expect(data.stockMovements).toHaveLength(1);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(b.id);
    expect(text).not.toMatch(/token_hash|tokenHash|password/);
  });

  it("needs a signed-in owner", async () => {
    expect((await request(t.app).get("/v1/backup")).status).toBe(401);
  });
});
