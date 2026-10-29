import { cachedRoute, jsonTextResponse } from "@/lib/server/routeCache";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const BACKEND_TIMEOUT_MS = 4000;
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
const CACHE_POLICY = { ttlMs: 60 * 60_000 };
const UNAVAILABLE = { error: "Historical events service is unavailable." };

async function loadEvents() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/events`, {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return { status: 503, body: JSON.stringify(UNAVAILABLE) };
    }

    return { status: 200, body: JSON.stringify(await response.json()) };
  } catch {
    return { status: 503, body: JSON.stringify(UNAVAILABLE) };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const result = await cachedRoute("events", CACHE_POLICY, loadEvents);
  return jsonTextResponse(result, CACHE_CONTROL);
}
