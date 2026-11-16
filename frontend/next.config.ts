import type { NextConfig } from "next";

// CSP_MODE=enforce switches the policy from report-only to enforcing. It is a
// build-time setting because next.config headers() runs at build; the default
// stays report-only so a deploy cannot enforce by accident.
const CSP_MODE = process.env.CSP_MODE === "enforce" ? "enforce" : "report-only";
const CSP_HEADER =
  CSP_MODE === "enforce"
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
// The Reporting API needs an absolute endpoint. Production is the default; a
// local verification build sets CSP_REPORT_ORIGIN=http://127.0.0.1:3000 so its
// reports stay local. The legacy report-uri uses the same absolute URL.
const CSP_REPORT_ORIGIN = (
  process.env.CSP_REPORT_ORIGIN ?? "https://strikehike.com"
).replace(/\/+$/, "");
const CSP_REPORT_URL = `${CSP_REPORT_ORIGIN}/api/v1/csp-report`;

const nextConfig: NextConfig = {
  output: "standalone",
  // The poster-mode Playwright build uses its own directory so it does not
  // replace the live build the main suite is serving.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
      // The weekly email's hosted images and web font. A mail client loads
      // the @font-face file cross-origin, as a browser would, so it needs CORS.
      {
        source: "/email/:path*",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
      // Transport and content-type hygiene. HSTS covers the apex only: no includeSubDomains, no preload.
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // Report-only by default; set CSP_MODE=enforce at build to enforce.
          // Add upgrade-insecure-requests when it is enforced: browsers ignore
          // that directive (and log an error) in a report-only policy.
          {
            key: CSP_HEADER,
            value: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; report-uri ${CSP_REPORT_URL}; report-to csp-endpoint`,
          },
          {
            // The Reporting API group. Chrome ignores a relative endpoint and
            // then sends nothing at all, so this one is absolute.
            key: "Reporting-Endpoints",
            value: `csp-endpoint="${CSP_REPORT_URL}"`,
          },
          {
            // The older Reporting API header, kept for browsers that still
            // read it; both point at the same endpoint.
            key: "Report-To",
            value: JSON.stringify({
              group: "csp-endpoint",
              max_age: 10886400,
              endpoints: [{ url: CSP_REPORT_URL }],
            }),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
