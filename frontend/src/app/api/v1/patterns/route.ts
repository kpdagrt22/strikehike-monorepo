import {
  cachedRoute,
  jsonTextResponse,
  type RouteLoadResult,
} from "@/lib/server/routeCache";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const BACKEND_TIMEOUT_MS = 20_000;
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
const CACHE_POLICY = { ttlMs: 60 * 60_000 };
const UNAVAILABLE = { error: "Pattern archive service is unavailable." };

async function loadPatterns(asset: string): Promise<RouteLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/patterns?asset=${encodeURIComponent(asset)}`,
      { signal: controller.signal, cache: "no-store" },
    );
    const payload = await response.json().catch(() => null);

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
  const asset = searchParams.get("asset") ?? "sp500";
  const result = await cachedRoute(`patterns:${asset}`, CACHE_POLICY, () =>
    loadPatterns(asset),
  );
  return jsonTextResponse(result, CACHE_CONTROL);
}
