import { cachedRoute, jsonTextResponse } from "@/lib/server/routeCache";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const BACKEND_TIMEOUT_MS = 8000;
// No long stale-while-revalidate: the ladder rolls over with the UTC date.
const CACHE_CONTROL = "public, max-age=300";
const CACHE_POLICY = { ttlMs: 60 * 60_000 };
const UNAVAILABLE = { error: "Forecast ladder service is unavailable." };

async function loadLadder() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/forecast-ladder?days=180&threshold=75&limit=5`,
      {
        signal: controller.signal,
        cache: "no-store",
      },
    );

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
  const utcDate = new Date().toISOString().slice(0, 10);
  const result = await cachedRoute(
    `forecast-ladder:${utcDate}`,
    CACHE_POLICY,
    loadLadder,
  );
  return jsonTextResponse(result, CACHE_CONTROL);
}
