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
const CACHE_POLICY = { ttlMs: 60 * 60_000, maxStaleMs: 6 * 60 * 60_000 };
const UNAVAILABLE = { error: "Case archive is unavailable." };

const ID_PATTERN = /^(today|[a-z0-9-]{3,48})$/;
const SERIES = new Set(["own", "sp500", "gold", "bonds", "nifty", "bitcoin"]);
const FROM_DAYS = new Set(["0", "-90", "-365", "-730"]);
const ALIGN = new Set(["peak", "latest"]);

function jsonError(status: number, detail: string): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadPath(upstreamPath: string): Promise<RouteLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(`${BACKEND_URL}${upstreamPath}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);

    // 404 (unknown id) and 422 (series not available for the case) pass
    // through with the upstream detail; a server fault is never a 500 here.
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
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!ID_PATTERN.test(id)) {
    return jsonError(404, "No case with that id in the catalogue.");
  }

  // Canonical query: only these three parameters reach the backend (unknown
  // ones are dropped), so the cache key space stays bounded.
  const query = new URL(request.url).searchParams;
  const isToday = id === "today";

  let series = query.get("series") ?? (isToday ? "sp500" : "own");
  if (!SERIES.has(series)) {
    return jsonError(
      422,
      "series must be one of own, sp500, gold, bonds, nifty, bitcoin.",
    );
  }
  // The today pseudo-case is always measured on a named asset.
  if (isToday && series === "own") series = "sp500";

  const from = query.get("from") ?? "0";
  if (!FROM_DAYS.has(from)) {
    return jsonError(422, "from must be one of 0, -90, -365, -730.");
  }

  const align = query.get("align") ?? "peak";
  if (!ALIGN.has(align)) {
    return jsonError(422, "align must be peak or latest.");
  }
  if (!isToday && align !== "peak") {
    return jsonError(
      422,
      "align=latest applies only to the today pseudo-case.",
    );
  }

  const upstream = new URLSearchParams();
  if (series !== "own") upstream.set("series", series);
  if (from !== "0") upstream.set("from", from);
  if (isToday && align !== "peak") upstream.set("align", align);
  const search = upstream.toString();
  const upstreamPath = `/api/v1/regime/cases/${id}/path${search ? `?${search}` : ""}`;

  const result = await cachedRoute(
    `regime-case-path:${id}:${series}:${from}:${align}`,
    CACHE_POLICY,
    () => loadPath(upstreamPath),
  );
  return jsonTextResponse(result, CACHE_CONTROL);
}
