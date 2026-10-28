import type { NextConfig } from "next";

// The browser only ever talks to this app's own address; /backend/* is forwarded to the API, so
// the sign-in cookie belongs to this address (browsers refuse cookies from another site).
const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/backend/:path*", destination: `${API_URL}/:path*` },
      // Links in emails (confirm address, reset password) are built from this app's address, so they must reach the API too.
      { source: "/v1/auth/:path*", destination: `${API_URL}/v1/auth/:path*` },
    ];
  },
};

export default nextConfig;
