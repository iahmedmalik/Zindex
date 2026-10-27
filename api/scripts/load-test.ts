// A small load test against a running API, using only Node's fetch. It signs in as one demo owner
// and measures the calls the owner makes all day: the dashboard, the order list, creating an order
// and the public delivery card. It reports real numbers (requests per second, median, 95th
// percentile, errors) and creates its own test orders in whatever database the API points at.
//
//   npm run seed -w @zindex/api                              (once, local database)
//   LOAD_API=http://127.0.0.1:4000 npm run load -w @zindex/api
//
// Never point it at production: it creates orders. Refuses anything that looks like a hosted API
// unless LOAD_ALLOW_HOSTED=1 is set on purpose.
const API = process.env.LOAD_API ?? "http://127.0.0.1:4000";
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3500";
const SECONDS = Number(process.env.LOAD_SECONDS ?? 10);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 8);

if (/onrender|vercel|neon/i.test(API) && process.env.LOAD_ALLOW_HOSTED !== "1") throw new Error("Refusing to load-test a hosted API. Set LOAD_ALLOW_HOSTED=1 if you really mean to.");

let cookie = "";
const sign = await fetch(`${API}/v1/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ email: "demo@zindex.test", password: "zindex-demo-1234" }) });
if (!sign.ok) throw new Error(`Could not sign in the demo owner (${sign.status}). Run the seed first.`);
cookie = (sign.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

const get = (path: string) => fetch(`${API}${path}`, { headers: { Cookie: cookie } });
const stores = ((await (await get("/v1/stores")).json()) as { stores: { id: string; name: string }[] }).stores;
const food = stores.find((s) => s.name === "Sheen Food") ?? stores[0]!;
const card = (await (await fetch(`${API}/v1/stores/${food.id}/orders`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ customerName: "Load Test", items: [{ name: "Load item", quantity: 1, unitPrice: 100 }] }) })).json()) as { order: { id: string } };
const token = ((await (await fetch(`${API}/v1/stores/${food.id}/orders/${card.order.id}/card`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" })).json()) as { token: string }).token;

type Scenario = { name: string; run: () => Promise<Response> };
const scenarios: Scenario[] = [
  { name: "GET dashboard", run: () => get("/v1/dashboard") },
  { name: "GET orders (list)", run: () => get(`/v1/stores/${food.id}/orders`) },
  { name: "GET stock", run: () => get(`/v1/stores/${food.id}/stock`) },
  { name: "GET public delivery card", run: () => fetch(`${API}/v1/public/card/${token}`) },
  { name: "POST order (create)", run: () => fetch(`${API}/v1/stores/${food.id}/orders`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ customerName: "Load Test", items: [{ name: "Load item", quantity: 2, unitPrice: 100 }], idempotencyKey: crypto.randomUUID() }) }) },
];

const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))] ?? 0;
console.log(`Load test: ${CONCURRENCY} at once for ${SECONDS} s per call, against ${API}\n`);
console.log("call".padEnd(28) + "requests".padStart(9) + "per sec".padStart(9) + "median ms".padStart(11) + "p95 ms".padStart(8) + "errors".padStart(8));
for (const s of scenarios) {
  const times: number[] = [];
  let errors = 0;
  const stop = Date.now() + SECONDS * 1000;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (Date.now() < stop) {
      const t0 = performance.now();
      try {
        const r = await s.run();
        await r.arrayBuffer();
        // the public card is rate limited at 120 a minute per address; a 429 there is the limiter working, not an error
        if (!r.ok && !(r.status === 429 && s.name.includes("public"))) errors++;
        if (r.status !== 429) times.push(performance.now() - t0);
      } catch { errors++; }
    }
  }));
  console.log(s.name.padEnd(28) + String(times.length).padStart(9) + (times.length / SECONDS).toFixed(1).padStart(9) + pct(times, 50).toFixed(1).padStart(11) + pct(times, 95).toFixed(1).padStart(8) + String(errors).padStart(8));
}
