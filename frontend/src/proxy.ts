import { NextResponse, type NextRequest } from "next/server";
import { gatePage } from "@/lib/server/pageGate";
import {
  clientIpFromHeaders,
  rateLimit,
  ROUTE_LIMITS,
} from "@/lib/server/rateLimit";

// Public proxy routes (/api): the rate limit. The internal bundle health read
// in routeCache goes straight to the backend, so it never passes through this
// limiter. The detail pages in the matcher's other entries are one backend read
// each (lib/server/pageGate.ts): a backend that fails with no last-good copy
// answers 503 there, never a 404.
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path !== "/api" && !path.startsWith("/api/")) return gatePage(request);

  const directIp = (request as NextRequest & { ip?: string }).ip;
  const ip = clientIpFromHeaders(request.headers, directIp);
  const daily = request.nextUrl.searchParams.get("resolution") === "daily";
  const pathname = request.nextUrl.pathname.replace(/\/+$/, "") || "/";
  const route = ROUTE_LIMITS[pathname] !== undefined ? pathname : null;
  const result = rateLimit.consume(ip, daily, route);

  if (!result.allowed) {
    return NextResponse.json(
      { detail: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  return NextResponse.next();
}

// A router prefetch goes straight to the page: a failed prefetch is discarded,
// and the navigation that follows it passes through the proxy.
export const config = {
  matcher: [
    "/api/:path*",
    {
      source: "/recessions/:id",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
    {
      source: "/declines/:id",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
    {
      source: "/events/:id",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
    {
      source: "/dates/:year/:list",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
