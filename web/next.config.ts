import type { NextConfig } from "next";

// The browser only ever talks to this app's own address; /backend/* is forwarded to the API, so
// the sign-in cookie belongs to this address (browsers refuse cookies from another site).
const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
