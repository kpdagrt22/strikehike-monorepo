import { eventIdFromSlug } from "@/lib/events/eventId";
import {
  cachedRoute,
  matchesEtag,
  textResponse,
  type RouteLoadResult,
} from "@/lib/server/routeCache";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const BACKEND_TIMEOUT_MS = 15_000;
const CACHE_POLICY = { ttlMs: 5 * 60_000, maxStaleMs: 24 * 60 * 60_000 };
const CONTENT_TYPE = "text/calendar; charset=utf-8";
const UNAVAILABLE = "Calendar file is unavailable.";

async function loadEventCalendar(id: string): Promise<RouteLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/events/${encodeURIComponent(id)}.ics`,
      { signal: controller.signal, cache: "no-store" },
    );
    const body = await response.text();
    if (response.status >= 500) {
      return { status: 503, body: UNAVAILABLE };
    }
    if (!response.ok) {
      return { status: response.status, body: "Not found" };
    }
    const headers: Record<string, string> = {
      "Content-Type": response.headers.get("content-type") ?? CONTENT_TYPE,
    };
    for (const [name, upstream] of [
      ["Cache-Control", "cache-control"],
      ["ETag", "etag"],
      ["Content-Disposition", "content-disposition"],
    ]) {
      const value = response.headers.get(upstream);
      if (value) headers[name] = value;
    }
    return { status: 200, body, headers };
  } catch {
    return { status: 503, body: UNAVAILABLE };
  } finally {
    clearTimeout(timer);
  }
}

// /calendar/event/<id with ":" as "~">.ics: one event as a calendar file.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const id = file.endsWith(".ics") ? eventIdFromSlug(file.slice(0, -4)) : null;
  if (id === null) {
    return new Response("Not found", { status: 404 });
  }

  const result = await cachedRoute(`events-event-ics:${id}`, CACHE_POLICY, () =>
    loadEventCalendar(id),
  );
  const etag = result.headers?.ETag;
  if (result.status === 200 && matchesEtag(request.headers.get("if-none-match"), etag)) {
    const headers: Record<string, string> = {};
    if (etag) headers.ETag = etag;
    const cacheControl = result.headers?.["Cache-Control"];
    if (cacheControl) headers["Cache-Control"] = cacheControl;
    return new Response(null, { status: 304, headers });
  }
  if (result.status !== 200) {
    return new Response(result.body, {
      status: result.status === 422 ? 404 : result.status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return textResponse(result, CONTENT_TYPE);
}
