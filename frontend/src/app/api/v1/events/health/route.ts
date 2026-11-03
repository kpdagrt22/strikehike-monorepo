import {
  jsonTextResponse,
  type RouteLoadResult,
} from "@/lib/server/routeCache";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const BACKEND_TIMEOUT_MS = 10_000;
// Health is the activation gate: never serve a cached old active_version.
const CACHE_CONTROL = "no-store";
const UNAVAILABLE = { error: "Events health service is unavailable." };

async function loadHealth(): Promise<RouteLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/events/health`, {
      signal: controller.signal,
      cache: "no-store",
    });
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

export async function GET() {
  const result = await loadHealth();
  return jsonTextResponse(result, CACHE_CONTROL);
}
