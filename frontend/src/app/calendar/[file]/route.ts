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
const FALLBACK_CONTENT_TYPE = "text/calendar; charset=utf-8";
const THEMES: Record<string, string> = {
  science: "Science",
  finance: "Finance",
  "culture-religion": "Culture/Religion",
  politics: "Politics",
  "natural-disasters": "Natural Disasters",
};
const UNAVAILABLE = "Calendar feed is unavailable.";

async function loadCalendar(theme: string | null): Promise<RouteLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  const query = theme ? `?themes=${encodeURIComponent(theme)}` : "";

  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/events/calendar.ics${query}`,
      { signal: controller.signal, cache: "no-store" },
    );
    const body = await response.text();
    const headers: Record<string, string> = {
      "Content-Type":
        response.headers.get("content-type") ?? FALLBACK_CONTENT_TYPE,
    };
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl) headers["Cache-Control"] = cacheControl;
    const etag = response.headers.get("etag");
    if (etag) headers.ETag = etag;

    if (response.status >= 500) {
      return { status: 503, body: UNAVAILABLE };
    }
    if (!response.ok) {
      return { status: response.status, body: body || UNAVAILABLE, headers };
    }
    return { status: 200, body, headers };
  } catch {
    return { status: 503, body: UNAVAILABLE };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  if (!file.endsWith(".ics")) {
    return new Response("Not found", { status: 404 });
  }
  const slug = file.slice(0, -4);
  if (slug !== "all" && !(slug in THEMES)) {
    return new Response("Not found", { status: 404 });
  }

  const result = await cachedRoute(
    `events-calendar:${slug}`,
    CACHE_POLICY,
    () => loadCalendar(slug === "all" ? null : THEMES[slug]),
  );
  const etag = result.headers?.ETag;
  if (result.status === 200 && matchesEtag(request.headers.get("if-none-match"), etag)) {
    const headers: Record<string, string> = {};
    if (etag) headers.ETag = etag;
    const cacheControl = result.headers?.["Cache-Control"];
    if (cacheControl) headers["Cache-Control"] = cacheControl;
    return new Response(null, { status: 304, headers });
  }
  return textResponse(result, FALLBACK_CONTENT_TYPE);
}
