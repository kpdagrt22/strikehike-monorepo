// Server reads for the server-rendered text, the JSON-LD and the sitemap. Server-only by use:
// import it from Server Components, metadata files and route handlers, never from a client module.
import { cache } from "react";

// Set only at runtime (docker-compose `environment`). Unset in the Docker build stage and in CI,
// so those builds prerender without data and ISR fills the data in on the server.
const BACKEND = process.env.CHRONO_API_URL?.replace(/\/+$/, "");

async function getJson(path: string): Promise<Record<string, unknown> | null> {
  if (!BACKEND) return null;
  // At runtime a failure throws on purpose: an ISR regeneration that throws keeps serving the
  // last good page (incremental-static-regeneration.md), instead of replacing it with an empty one.
  const response = await fetch(`${BACKEND}${path}`, {
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== "object") throw new Error(`${path} returned no JSON object`);
  return data as Record<string, unknown>;
}

// ---------------------------------------------------------------------------------------------
// Payload types: only the fields the SEO layer reads are named. Every object keeps an index
// signature, so a caller may pass the payload on whole (or slim it) without casting to `any`.
// ---------------------------------------------------------------------------------------------

/** One NBER recession window from `/api/v1/regime/macro-history` (`crashes[]`). */
export interface NberWindow {
  id: string; // "nber-1854-11"
  name: string; // "Recession of 1854"
  type?: string; // "nber_recession"
  start: string; // "1854-11-01"
  end: string; // "1854-12-31"
  start_month: string; // "1854-11"
  end_month: string; // "1854-12"
  duration_days?: number;
  date_precision?: string; // "month"
  ongoing?: boolean;
  within_coverage?: boolean;
  [key: string]: unknown;
}

/** `meta.latest_core_index`: the latest weekly Core Index v2 reading. */
export interface CoreIndexReading {
  date: string;
  score: number | null; // −50 … +50
  bucket: string | null; // "extreme_bearish" | "bearish_warning" | "calm_bullish" | "strong_bullish"
  severity?: string | null;
  warning?: boolean;
  trend_warning?: boolean;
  fast_warning?: boolean;
  signal_date?: string | null;
  [key: string]: unknown;
}

export interface RegimeMeta {
  generated_at?: string;
  data_version?: string;
  core_index_version?: string; // "core-index-v2"
  core_index_first_scored?: string | null; // "1928-12-28"
  core_index_cadence?: string; // "weekly"
  latest_core_index?: CoreIndexReading | null;
  nber_source?: string; // "USREC"
  notes?: string[];
  [key: string]: unknown;
}

/** `/api/v1/regime/macro-history?resolution=monthly&start=2025-01-01`. */
export interface RegimeSummary {
  as_of: string; // "2026-10-27"
  coverage: { start: string; end: string; years?: number; [key: string]: unknown };
  crashes: NberWindow[];
  meta: RegimeMeta;
  [key: string]: unknown;
}

/** One `kinds[]` entry of the case catalogue (payload order is display order). */
export interface CaseKind {
  key: string; // "us_equity" | "india_equity" | "bitcoin" | "gold" | "treasury"
  label: string;
  region?: string;
  threshold_pct?: number;
  rule: string;
  [key: string]: unknown;
}

export interface CaseSeries {
  key: string; // "sp500" | "nifty" | "bitcoin" | "gold" | "bonds"
  source?: string;
  label: string;
  resolution?: string; // "daily" | "monthly"
  precision: string; // "day" | "month"
  spans_splice?: boolean;
  [key: string]: unknown;
}

/** One `cases[]` entry of `/api/v1/regime/cases`. */
export interface DeclineCase {
  id: string; // "us-equity-2007-10"
  kind: string; // a CaseKind key
  name: string;
  short_name?: string;
  region?: string;
  series: CaseSeries;
  peak: string;
  trough: string | null;
  recovery: string | null;
  recovery_status: string; // "recovered" | "not_recovered" | "unobservable"
  depth_pct: number | null; // negative, e.g. −56.8
  days_to_trough?: number | null;
  days_to_recovery?: number | null;
  latest?: { date: string; pct_from_peak: number | null; [key: string]: unknown } | null;
  recessions: string[]; // NberWindow ids the peak-to-low window overlaps
  description?: string;
  flags: {
    open?: boolean;
    recovery_unobservable?: boolean;
    spans_splice?: boolean;
    month_precise?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** `/api/v1/regime/cases`. */
export interface CaseCatalogue {
  version?: string; // "regime-cases-v1"
  as_of: string;
  data_version: string;
  coverage: {
    series_first_obs?: Record<string, string>; // { sp500: "1871-01-01", … }
    series_last_obs?: Record<string, string>;
    [key: string]: unknown;
  };
  kinds: CaseKind[];
  cases: DeclineCase[];
  notes: string[];
  default_pair?: { a: string; b: string };
  pairs?: { a: string; b: string }[];
  recessions?: { id: string; name: string; start_month: string; end_month: string }[];
  counts?: Record<string, number>;
  [key: string]: unknown;
}

/** `engine` of `/api/v1/patterns` (patterns-v2). `engine.as_of` is the data date. */
export interface PatternsEngine {
  version: string; // "patterns-v2"
  status?: string;
  asset?: string;
  as_of: string; // the date the data run to: what the page's "As of" chip shows
  history_start?: string;
  [key: string]: unknown;
}

/** `/api/v1/patterns?asset=sp500`. The top-level `as_of` is the request day, not the data date. */
export interface PatternsPayload {
  as_of: string;
  asset: string;
  asset_label: string;
  engine: PatternsEngine;
  notes: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------------------------
// Reads. Each returns null when CHRONO_API_URL is unset (build and CI) and throws on a bad
// response at runtime. Callers that must never fail (sitemap, JSON-LD) add `.catch(() => null)`.
// ---------------------------------------------------------------------------------------------

// Monthly points from 2025 keep this small (≈30 KB); `crashes` and `meta` are always complete.
export const getRegimeSummary = cache(async (): Promise<RegimeSummary | null> => {
  const p = await getJson("/api/v1/regime/macro-history?resolution=monthly&start=2025-01-01");
  if (!p) return null;
  if (!Array.isArray(p.crashes) || !p.meta || !p.coverage) throw new Error("macro-history shape");
  return p as unknown as RegimeSummary;
});

export const getCaseCatalogue = cache(async (): Promise<CaseCatalogue | null> => {
  const p = await getJson("/api/v1/regime/cases");
  if (!p) return null;
  if (!Array.isArray(p.cases) || !Array.isArray(p.kinds)) throw new Error("cases shape");
  return p as unknown as CaseCatalogue;
});

export const getPatternsDefault = cache(async (): Promise<PatternsPayload | null> => {
  const p = await getJson("/api/v1/patterns?asset=sp500");
  if (!p) return null;
  if ((p.engine as { version?: string } | null)?.version !== "patterns-v2") throw new Error("patterns engine");
  return p as unknown as PatternsPayload;
});

/** The date the Patterns data run to (YYYY-MM-DD): `engine.as_of`, never the top-level request
 *  day. Use it for the sitemap lastmod and the /patterns WebPage `dateModified`. */
export function patternsAsOf(payload: PatternsPayload | null | undefined): string | undefined {
  const asOf = payload?.engine?.as_of;
  return typeof asOf === "string" && asOf ? asOf.slice(0, 10) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Upcoming events. The server page reads the backend directly (not through /api), like the
// other server data here, so the first HTML carries every listed event.
// ---------------------------------------------------------------------------------------------

export interface UpcomingEventPayload {
  event_id: string;
  name: string;
  theme: string;
  start_date: string;
  start_time: string | null;
  timezone: string | null;
  start_utc: string | null;
  all_day: boolean;
  status: string;
  verification: string;
  source_url: string;
  days_until: number;
  [key: string]: unknown;
}

export interface UpcomingThemePayload {
  schedulable: boolean;
  total_available: number;
  events: UpcomingEventPayload[];
  [key: string]: unknown;
}

export interface UpcomingPayload {
  as_of: string;
  bundle_version: string | null;
  message?: string | null;
  themes: Record<string, UpcomingThemePayload>;
  [key: string]: unknown;
}

export const getUpcoming = cache(async (): Promise<UpcomingPayload | null> => {
  const payload = await getJson(
    "/api/v1/events/upcoming?limit_per_theme=50&horizon_days=365",
  );
  if (!payload) return null;
  if (!payload.themes || typeof payload.themes !== "object") {
    throw new Error("upcoming shape");
  }
  return payload as unknown as UpcomingPayload;
});
