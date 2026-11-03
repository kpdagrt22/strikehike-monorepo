import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // No X-Powered-By header.
  poweredByHeader: false,
  // Pin the workspace root to this project (multiple lockfiles exist on disk).
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    return [
      {
        // One host for search engines: www answers with a 308 to the apex, path and query kept.
        // Caddy passes the Host header through, so www requests reach Next with their own host.
        // (Done here, not in the Caddyfile, which another deploy rewrites on the server.)
        source: "/:path*",
        has: [{ type: "host", value: "www.strikehike.com" }],
        destination: "https://strikehike.com/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      // Keep /api crawlable (Google's renderer fetches it) but out of the index. Never Disallow it.
      {
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
      // Transport and content-type hygiene. HSTS covers the apex only: no includeSubDomains, no preload.
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
