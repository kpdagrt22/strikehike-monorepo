import {
  cachedRoute,
  jsonTextResponse,
  type RouteLoadResult,
} from "@/lib/server/routeCache";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const BACKEND_TIMEOUT_MS = 15_000;
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";
const CACHE_POLICY = { ttlMs: 60 * 60_000, maxStaleMs: 24 * 60 * 60_000 };
const UNAVAILABLE = { error: "Upcoming events service is unavailable." };
const UPSTREAM_PARAMS = ["themes", "limit_per_theme", "horizon_days"];

async function loadUpcoming(query: string): Promise<RouteLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/events/upcoming${query ? `?${query}` : ""}`,
      { signal: controller.signal, cache: "no-store" },
    );
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // One canonical query is both the upstream request and the cache key, so an
  // unknown parameter cannot reach FastAPI or mint a new entry.
  const canonical = new URLSearchParams();
  for (const name of UPSTREAM_PARAMS) {
    const value = searchParams.get(name);
    if (value !== null) canonical.set(name, value);
  }
  const query = canonical.toString();
  const result = await cachedRoute(
    `events-upcoming:${query}`,
    CACHE_POLICY,
    () => loadUpcoming(query),
  );
  return jsonTextResponse(result, CACHE_CONTROL);
}
