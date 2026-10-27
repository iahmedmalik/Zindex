// Fills the LOCAL development database with a demo owner, three stores, products, stock and orders in
// different stages, so the screens have something real to show. Safe to run twice. Never run it
// against production: it signs up a throwaway account with a public password.
//
//   npm run dev:db -w @zindex/api     (leave it running)
//   npm run dev -w @zindex/api        (the API, port 4000)
//   npm run seed -w @zindex/api
import pg from "pg";

const API = process.env.SEED_API ?? "http://127.0.0.1:4000";
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3500";
const OWNER_URL = process.env.DATABASE_URL_OWNER ?? "postgres://postgres:owner_local@127.0.0.1:5434/zindex";
const EMAIL = "demo@zindex.test";
const PASSWORD = "zindex-demo-1234";

if (/render|neon|vercel/i.test(API + OWNER_URL)) throw new Error("Refusing to seed anything that looks like production.");

let cookie = "";
async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const data = res.status === 204 ? ({} as T) : ((await res.json().catch(() => ({}))) as T);
  return { status: res.status, data };
}

await call("POST", "/auth/sign-up/email", { name: "Demo Owner", email: EMAIL, password: PASSWORD });
const db = new pg.Client({ connectionString: OWNER_URL });
await db.connect();
await db.query(`update "user" set email_verified = true where email = $1`, [EMAIL]);
await db.end();
const signIn = await call("POST", "/auth/sign-in/email", { email: EMAIL, password: PASSWORD });
if (signIn.status !== 200) throw new Error(`Could not sign in the demo owner: ${JSON.stringify(signIn.data)}`);

const existing = (await call<{ stores: { id: string; name: string }[] }>("GET", "/stores")).data.stores;
if (existing.length > 0) {
  console.log(`Demo data already there (${existing.length} stores). Sign in as ${EMAIL} / ${PASSWORD}`);
  process.exit(0);
}

const store = async (name: string, invoicePrefix: string, accent: string, phone: string, address: string) =>
  (await call<{ store: { id: string } }>("POST", "/stores", { name, invoicePrefix, accent, phone, address })).data.store.id;
const food = await store("Sheen Food", "SF", "#8a3b12", "0300 1112223", "Shop 3, Main Market, Model Town, Lahore");
const perfumes = await store("Sheen Perfumes", "SP", "#5d1b23", "0300 1112224", "Office 2, Gulberg III, Lahore");
const clothes = await store("The Sheen Store", "TS", "#1f3a5f", "0300 1112225", "Shop 9, Liberty Market, Lahore");

const product = async (store: string, name: string, price: number, cost: number, stock: number) => {
  const id = (await call<{ product: { id: string } }>("POST", `/stores/${store}/products`, { name, price, cost })).data.product.id;
  if (stock) await call("POST", `/stores/${store}/stock/adjust`, { productId: id, delta: stock, note: "Opening stock" });
  return id;
};
const garam = await product(food, "Garam masala 100 g", 450, 300, 40);
const chilli = await product(food, "Red chilli powder 250 g", 380, 250, 25);
const haldi = await product(food, "Turmeric 200 g", 320, 200, 3);
const oud = await product(perfumes, "Oud Royale 50 ml", 6500, 4200, 12);
const musk = await product(perfumes, "White Musk 30 ml", 3200, 1900, 18);
await product(clothes, "Cotton kurta (M)", 4200, 2600, 10);
await product(clothes, "Lawn dupatta", 1800, 900, 22);

const order = async (store: string, body: object) => (await call<{ order: { id: string } }>("POST", `/stores/${store}/orders`, body)).data.order.id;
const status = (store: string, id: string, ...steps: string[]) => steps.reduce((p, s) => p.then(() => call("POST", `/stores/${store}/orders/${id}/status`, { status: s })), Promise.resolve<unknown>(null));

const o1 = await order(food, { customerName: "Ayesha Khan", customerPhone: "0300 1234567", address: "House 4, Street 2, Model Town, Lahore", payment: "cod", riderFee: 350, items: [{ productId: garam, quantity: 2 }, { productId: chilli, quantity: 1 }], discountPercent: 10 });
await status(food, o1, "confirmed", "packed");
await call("POST", `/stores/${food}/orders/${o1}/invoice`);
await call("POST", `/stores/${food}/orders/${o1}/invoice/finalise`);

const o2 = await order(food, { customerName: "Bilal Ahmed", customerPhone: "0321 7654321", address: "Flat 12, Johar Town, Lahore", payment: "paid", paymentMethod: "Easypaisa", riderFee: 300, items: [{ productId: haldi, quantity: 4 }] });
await status(food, o2, "confirmed", "packed", "out_for_delivery");
await call("PUT", `/stores/${food}/orders/${o2}/delivery`, { service: "yango", riderName: "Imran", riderPhone: "0345 5551212", bikeNumber: "LEA-1234" });
await call("POST", `/stores/${food}/orders/${o2}/delivery/status`, { status: "booked" });
await call("POST", `/stores/${food}/orders/${o2}/delivery/status`, { status: "picked_up" });
await call("POST", `/stores/${food}/orders/${o2}/payment/confirm`);

const o3 = await order(perfumes, { customerName: "Hira Malik", customerPhone: "0333 1239876", address: "Block C, DHA Phase 5, Lahore", payment: "cod", deliveryKind: "courier", deliveryCharge: 250, items: [{ productId: oud, quantity: 1 }, { productId: musk, quantity: 2 }] });
await status(perfumes, o3, "confirmed");

await order(clothes, { customerName: "Sana Iqbal", customerPhone: "0300 5550001", address: "Wapda Town, Lahore", payment: "cod", riderFee: 400, items: [{ name: "Cotton kurta (M)", quantity: 1, unitPrice: 4200 }] });
const o5 = await order(food, { customerName: "Omar Farooq", customerPhone: "0302 4443210", address: "Samanabad, Lahore", payment: "unpaid", riderFee: 250, items: [{ productId: garam, quantity: 1 }] });
await status(food, o5, "confirmed", "packed", "out_for_delivery", "delivered");

const card = await call<{ url: string }>("POST", `/stores/${food}/orders/${o2}/card`, { days: 7 });
console.log(`Seeded. Sign in as ${EMAIL} / ${PASSWORD}`);
console.log(`Sample delivery card: ${card.data.url}`);
