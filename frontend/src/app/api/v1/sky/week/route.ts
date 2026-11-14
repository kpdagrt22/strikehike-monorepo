import {
  cachedRoute,
  jsonTextResponse,
  type RouteLoadResult,
} from "@/lib/server/routeCache";
import {
  canonicalSkyQuery,
  skyWeekCacheKey,
  validSkyStart,
} from "@/lib/server/skyWeek";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const BACKEND_TIMEOUT_MS = 15_000;
// A week is immutable once published; 24 hours is both the browser and
// in-process lifetime.
const CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=86400";
const CACHE_POLICY = { ttlMs: 24 * 60 * 60_000, maxStaleMs: 24 * 60 * 60_000 };
const UNAVAILABLE = { error: "Sky week service is unavailable." };
const INVALID = {
  error: "start must be a Monday between 2000-01-03 and 2040-12-31",
};

async function loadSkyWeek(query: string): Promise<RouteLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/sky/week?${query}`,
      { signal: controller.signal, cache: "no-store" },
    );
    // Always read the body: a 4xx/5xx JSON payload is passed through, and an
    // unread body would keep the upstream connection open.
    const payload = await response.json().catch(() => null);

    if (response.status >= 500) {
      return { status: 503, body: JSON.stringify(UNAVAILABLE) };
    }
    if (!response.ok) {
      return {
        status: response.status,
        body: JSON.stringify(payload ?? UNAVAILABLE),
      };
    }
    if (payload == null) {
      return { status: 503, body: JSON.stringify(UNAVAILABLE) };
    }
    return { status: 200, body: JSON.stringify(payload) };
  } catch {
    return { status: 503, body: JSON.stringify(UNAVAILABLE) };
  } finally {
    clearTimeout(timer);
  }
}

// The /api/:path* proxy applies the shared 240-request/minute bucket before
// this handler runs (frontend/src/proxy.ts and lib/server/rateLimit.js).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = validSkyStart(searchParams.get("start"));
  if (!start) {
    // Validation happens before cachedRoute, so an invalid start neither
    // calls FastAPI nor creates a cache entry.
    return jsonTextResponse(
      { status: 422, body: JSON.stringify(INVALID) },
      CACHE_CONTROL,
    );
  }

  const query = canonicalSkyQuery(new URLSearchParams({ start }));
  const result = await cachedRoute(
    skyWeekCacheKey(query),
    CACHE_POLICY,
    () => loadSkyWeek(query),
  );
  return jsonTextResponse(result, CACHE_CONTROL);
}
