import { NextResponse, type NextRequest } from "next/server";
import { clientIpFromHeaders, rateLimit } from "@/lib/server/rateLimit";

// Public proxy routes only. The internal bundle health read in routeCache goes
// straight to the backend, so it never passes through this limiter.
export function proxy(request: NextRequest) {
  const directIp = (request as NextRequest & { ip?: string }).ip;
  const ip = clientIpFromHeaders(request.headers, directIp);
  const daily = request.nextUrl.searchParams.get("resolution") === "daily";
  const result = rateLimit.consume(ip, daily);

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

export const config = {
  matcher: "/api/:path*",
};
