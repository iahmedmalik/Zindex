import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { fill, waNumber } from "../src/whatsapp/templates";
import { buildTestApp, newId, newVerifiedOwner } from "./helpers";

const t = buildTestApp();
afterAll(() => t.close());

const api = (cookie: string) => {
  const call = (method: "get" | "post" | "put" | "delete", path: string, body?: object) => request(t.app)[method](path).set("Cookie", cookie).send(body);
  return {
    store: async () => (await call("post", "/v1/stores", { name: "Sheen Food" + newId("") })).body.store.id as string,
    order: async (store: string) =>
      (await call("post", `/v1/stores/${store}/orders`, { customerName: "Ayesha", customerPhone: "0300 1234567", payment: "cod", riderFee: 350, items: [{ name: "Spice", quantity: 2, unitPrice: 500 }] })).body.order.id as string,
    message: (s: string, o: string, template: string, link = "") => call("get", `/v1/stores/${s}/orders/${o}/whatsapp?template=${template}&link=${encodeURIComponent(link)}`),
    templates: (s: string) => call("get", `/v1/stores/${s}/templates`),
    edit: (s: string, key: string, body: string) => call("put", `/v1/stores/${s}/templates/${key}`, { body }),
    reset: (s: string, key: string) => call("delete", `/v1/stores/${s}/templates/${key}`),
  };
};

describe("whatsapp helpers", () => {
  it("makes wa.me numbers and fills fields without printing undefined", () => {
    expect(waNumber("0300 1234567")).toBe("923001234567");
    expect(waNumber(null)).toBeNull();
    expect(fill("Hi {name}, bike {bike} {link}", { name: "Ayesha" })).toBe("Hi Ayesha, bike");
  });
});

describe("whatsapp messages", () => {
  it("fills the default template from the order and builds the wa.me link", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const order = await a.order(store);
    const msg = (await a.message(store, order, "on_the_way", "https://zindex.example/c/abc")).body;
    expect(msg.text).toContain("Hi Ayesha");
    expect(msg.text).toContain("order #1");
    expect(msg.text).toContain("PKR 1,350"); // goods 1000 + rider fee 350
    expect(msg.text).toContain("https://zindex.example/c/abc");
    expect(msg.waLink.startsWith("https://wa.me/923001234567?text=")).toBe(true);
    expect(decodeURIComponent(msg.waLink.split("text=")[1])).toBe(msg.text);
  });

  it("lets each store edit its own wording and go back to the default", async () => {
    const o = await newVerifiedOwner(t.app, t.mailer);
    const a = api(o.cookie);
    const store = await a.store();
    const other = await a.store();
    const order = await a.order(store);
    expect((await a.templates(store)).body.templates).toHaveLength(8); // the seven delivery messages and "ready for pickup"
    await a.edit(store, "thank_you", "Shukriya {name}! - {store}");
    expect((await a.message(store, order, "thank_you")).body.text).toMatch(/^Shukriya Ayesha! - Sheen Food/);
    expect((await a.templates(store)).body.templates.find((x: { key: string }) => x.key === "thank_you").edited).toBe(true);
    expect((await a.templates(other)).body.templates.find((x: { key: string }) => x.key === "thank_you").edited).toBe(false);
    await a.reset(store, "thank_you");
    expect((await a.message(store, order, "thank_you")).body.text).toContain("Thank you for ordering");
  });

  it("refuses unknown templates and keeps other owners out", async () => {
    const x = await newVerifiedOwner(t.app, t.mailer);
    const y = await newVerifiedOwner(t.app, t.mailer);
    const store = await api(x.cookie).store();
    const order = await api(x.cookie).order(store);
    expect((await api(x.cookie).message(store, order, "nonsense")).status).toBe(404);
    expect((await api(x.cookie).edit(store, "nonsense", "x")).status).toBe(404);
    expect((await api(y.cookie).message(store, order, "invoice")).status).toBe(404);
    expect((await api(y.cookie).edit(store, "invoice", "hijacked")).status).toBe(404);
    expect((await api(y.cookie).templates(store)).body.templates.every((t: { edited: boolean }) => !t.edited)).toBe(true);
  });
});
