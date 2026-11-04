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
const CACHE_POLICY = { ttlMs: 15 * 60_000, maxStaleMs: 60 * 60_000 };
const UNAVAILABLE = { error: "Macro regime service is unavailable." };
// The longest daily window any view asks for is CrashDetailPanel's 1873-04-01
// to 1879-03-31 span around the 65-month NBER recession: 2,190 days. 1.25x
// that is 2,737.5, rounded up; the 3-year floor is already smaller.
const MAX_DAILY_RANGE_DAYS = 2_738;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// view=atlas (weekly only): the timeline fields the /regime page reads
// (RegimeTimeline, MacroHUD, ChartCrosshairLegend, PhasePlane and the asset
// fields in assetTargets.js). Re-check those consumers before changing this.
// Daily windows are never projected. core_index_fast_warning is sent from
// data 59192d5aa731; an older artifact omits it, which the page reads as no
// flag.
const ATLAS_FIELDS = [
  "date",
  "core_index",
  "core_index_bucket",
  "core_index_severity",
  "core_index_warning",
  "core_index_trend_warning",
  "core_index_fast_warning",
  "sp500_proxy",
  "proxy_source",
  "gold_proxy",
  "bond_proxy",
  "nifty_proxy",
  "1y_volatility_percentile",
  "drawdown_1y",
  "gold_1y_volatility_percentile",
  "gold_drawdown_1y",
  "bond_1y_volatility_percentile",
  "bond_drawdown_1y",
  "nifty_1y_volatility_percentile",
  "nifty_drawdown_1y",
];

type JsonRecord = Record<string, unknown>;

/** Keeps every top-level key; slims timeline points and omits null values. */
function projectAtlas(payload: JsonRecord): JsonRecord {
  if (!Array.isArray(payload?.timeline)) return payload;
  return {
    ...payload,
    timeline: payload.timeline.map((point: JsonRecord) => {
      const slim: JsonRecord = {};
      for (const field of ATLAS_FIELDS) {
        const value = point?.[field];
        if (value !== null && value !== undefined) slim[field] = value;
      }
      return slim;
    }),
  };
}

async function loadMacroHistory(
  query: string,
  atlas: boolean,
): Promise<RouteLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/regime/macro-history${query ? `?${query}` : ""}`,
      { signal: controller.signal, cache: "no-store" },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      return {
        status: response.status,
        body: JSON.stringify(payload ?? UNAVAILABLE),
      };
    }

    if (!atlas) {
      // Default contract: the upstream JSON passes through unparsed.
      return { status: 200, body: await response.text() };
    }

    return {
      status: 200,
      body: JSON.stringify(projectAtlas(await response.json())),
    };
  } catch {
    return { status: 503, body: JSON.stringify(UNAVAILABLE) };
  } finally {
    clearTimeout(timer);
  }
}

// The only parameters the FastAPI endpoint accepts, in a fixed order.
const UPSTREAM_PARAMS = ["resolution", "start", "end"];

function parseIsoDate(value: string | null) {
  if (!value || !ISO_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

function badRequest(detail: string): Response {
  return jsonTextResponse(
    { status: 400, body: JSON.stringify({ detail }) },
    CACHE_CONTROL,
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const resolution = searchParams.get("resolution");
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const startDate = parseIsoDate(start);
  const endDate = parseIsoDate(end);

  if (start && !startDate) {
    return badRequest("start must be an ISO date (YYYY-MM-DD).");
  }
  if (end && !endDate) {
    return badRequest("end must be an ISO date (YYYY-MM-DD).");
  }
  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    return badRequest("start must be on or before end.");
  }
  if (resolution === "daily") {
    if (!startDate || !endDate) {
      return badRequest("resolution=daily requires start and end.");
    }
    const days = Math.round(
      (endDate.getTime() - startDate.getTime()) / 86_400_000,
    );
    if (days > MAX_DAILY_RANGE_DAYS) {
      return badRequest(
        `Daily ranges are capped at ${MAX_DAILY_RANGE_DAYS} days.`,
      );
    }
  }

  const atlas =
    searchParams.get("view") === "atlas" && resolution === "weekly";

  // One canonical query is both the upstream request and the cache key, so
  // unknown parameters can neither reach the backend nor mint new entries.
  const canonical = new URLSearchParams();
  for (const name of UPSTREAM_PARAMS) {
    const value = searchParams.get(name);
    if (value !== null) canonical.set(name, value);
  }
  const query = canonical.toString();
  const result = await cachedRoute(
    `macro-history:${atlas ? "atlas" : "full"}?${query}`,
    CACHE_POLICY,
    () => loadMacroHistory(query, atlas),
  );
  return jsonTextResponse(result, CACHE_CONTROL);
}
