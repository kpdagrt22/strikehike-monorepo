import { eventIdFromSlug } from "@/lib/events/eventId";
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
// The same caching as /api/v1/events/upcoming: the event comes from the same bundle.
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";
const CACHE_POLICY = { ttlMs: 5 * 60_000, maxStaleMs: 24 * 60 * 60_000 };
const UNAVAILABLE = { error: "Events service is unavailable." };
const BAD_ID = { detail: "Not an event id." };
const NOT_HERE = { detail: "Calendar files are at /calendar/event/<id>.ics." };

async function loadEvent(id: string): Promise<RouteLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/events/${encodeURIComponent(id)}`,
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: segment } = await params;
  // The calendar file is served at /calendar/event/<id>.ics, not here.
  if (segment.endsWith(".ics")) {
    return jsonTextResponse(
      { status: 404, body: JSON.stringify(NOT_HERE) },
      CACHE_CONTROL,
    );
  }
  // Checked here too, so a malformed id never reaches FastAPI or the cache.
  // Both the raw id (":") and its URL form ("~") are accepted.
  const id = eventIdFromSlug(segment);
  if (id === null) {
    return jsonTextResponse(
      { status: 422, body: JSON.stringify(BAD_ID) },
      CACHE_CONTROL,
    );
  }
  const result = await cachedRoute(`events-event:${id}`, CACHE_POLICY, () =>
    loadEvent(id),
  );
  return jsonTextResponse(result, CACHE_CONTROL);
}
