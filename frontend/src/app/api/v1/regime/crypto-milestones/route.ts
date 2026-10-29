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
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
const CACHE_POLICY = { ttlMs: 60 * 60_000 };
const UNAVAILABLE = { error: "Crypto milestone service is unavailable." };

async function loadMilestones(): Promise<RouteLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/regime/crypto-milestones`,
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

export async function GET() {
  const result = await cachedRoute(
    "crypto-milestones",
    CACHE_POLICY,
    loadMilestones,
  );
  return jsonTextResponse(result, CACHE_CONTROL);
}
