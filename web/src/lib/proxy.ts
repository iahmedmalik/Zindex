// Forwards a browser request to the API and hands the answer back. The browser only ever talks to this app's own
// address (so the sign-in cookie belongs to it); this is the one place that talks on to the API.
//
// Why not a plain rewrite in next.config? A rewrite cannot tell the API who the visitor is. On Vercel the API only
// sees this app's server address, so every visitor would share one rate-limit count. Here we add the visitor's
// address and a shared secret (PROXY_SECRET); the API trusts that pair and nothing else (api/src/rate-limit.ts).

const API_URL = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

// Headers that describe one hop only, or that fetch has already dealt with, must not be copied across.
const SKIP_REQUEST = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "expect", "x-zindex-client-ip", "x-zindex-proxy"]);
const SKIP_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie"]);

function visitorAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "";
}

/** `strip` is the part of the address the API does not have ("/backend"); "" keeps the path as it is. */
export async function forward(req: Request, strip: string): Promise<Response> {
  const url = new URL(req.url);
  const path = strip && url.pathname.startsWith(strip) ? url.pathname.slice(strip.length) : url.pathname;

  const headers = new Headers();
  req.headers.forEach((value, name) => {
    if (!SKIP_REQUEST.has(name.toLowerCase())) headers.set(name, value);
  });
  const visitor = visitorAddress(req);
  if (visitor) headers.set("x-zindex-client-ip", visitor);
  if (process.env.PROXY_SECRET) headers.set("x-zindex-proxy", process.env.PROXY_SECRET);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}${path}${url.search}`, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual", // the API's redirects (email links) go to the browser as they are
      cache: "no-store",
    });
  } catch {
    // The API could not be reached (for example a sleeping free server). 502 is what the app already waits and retries on.
    return new Response("The server could not be reached.", { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!SKIP_RESPONSE.has(name.toLowerCase())) out.set(name, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers: out });
}
