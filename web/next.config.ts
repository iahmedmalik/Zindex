import type { NextConfig } from "next";

// The browser only ever talks to this app's own address. /backend/* and /v1/auth/* are forwarded to the API by
// route handlers (src/app/backend, src/app/v1/auth; the shared code is src/lib/proxy.ts), which also tell the
// API who the visitor is. The API address comes from API_URL when the request is handled, not at build time.
const nextConfig: NextConfig = {};

export default nextConfig;
