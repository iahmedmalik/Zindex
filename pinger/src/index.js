// Keeps the free Render API awake during shop hours. Cloudflare calls scheduled() on the cron times in
// wrangler.toml. If the API is asleep the first request takes about 40 s, so each try waits up to 60 s.
const HEALTH_URL = "https://zindex-api.onrender.com/health";
const TRIES = 3;

export default {
  async scheduled(_event, _env, ctx) {
    ctx.waitUntil(ping());
  },
  // Opening the Worker's address in a browser runs one ping, handy to check the setup.
  async fetch() {
    const status = await ping();
    return new Response(status === 200 ? "awake" : `not awake (${status})`, { status: status === 200 ? 200 : 502 });
  },
};

async function ping() {
  let status = 0;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(60_000) });
      status = res.status;
      if (res.ok) break;
    } catch {
      status = 0;
    }
    console.log(`try ${attempt} failed (${status})`);
  }
  console.log(`health ${status}`);
  return status;
}
