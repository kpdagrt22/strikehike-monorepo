// Shared facts for the reference pages (/recessions and /declines). Everything
// here is read from the payload the Regime page already loads: the NBER windows
// and weekly atlas, and the 20% fall record in Method & record. No new metric.
import { buildCrashMetrics } from "@/components/regime/regimeMetrics";
import { addDaysIso } from "@/components/regime/regimeUtils";
import type {
  NberWindow,
  RegimeAtlas,
  RegimeMeta,
  RegimePoint,
} from "@/lib/seo/data";

export type TrendFall = {
  id: string;
  name: string;
  peak: string;
  low: string;
  size: number;
  first_warning: string | null;
  warning_on_since: string | null;
  down_then: number | null;
  within_first_20pct: boolean;
  warnings_before_20pct_mark: number | null;
  left_on_from_the_decline_before: boolean;
};

export type TrendRecord = {
  falls: TrendFall[];
  count: number;
  onWithinFirst20Pct: number | null;
  notWithinFirst20Pct: number | null;
};

const DAY = 86_400_000;
const LOOKBACK_DAYS = 182;

export function daysBetween(start: string, end: string) {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / DAY) + 1;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function declineId(fall: Pick<TrendFall, "peak" | "name">) {
  return `${fall.peak}-${slugify(fall.name)}`;
}

export const recessionPath = (id: string) => `/recessions/${id}`;
export const declinePath = (id: string) => `/declines/${id}`;

function fallRecord(meta: RegimeMeta | null | undefined) {
  const warning = meta?.core_index_trend_warning as
    | { record?: { falls_of_20pct_or_more?: Record<string, unknown> } }
    | undefined;
  return warning?.record?.falls_of_20pct_or_more ?? null;
}

export function trendRecord(
  meta: RegimeMeta | null | undefined,
): TrendRecord | null {
  const block = fallRecord(meta);
  if (!block || !Array.isArray(block.falls)) return null;
  const falls: TrendFall[] = block.falls
    .filter(
      (fall): fall is Record<string, unknown> =>
        Boolean(fall) && typeof fall === "object",
    )
    .map((fall) => ({
      id: declineId({
        peak: String(fall.peak ?? ""),
        name: String(fall.name ?? ""),
      }),
      name: String(fall.name ?? ""),
      peak: String(fall.peak ?? ""),
      low: String(fall.low ?? ""),
      size: Number(fall.size),
      first_warning:
        typeof fall.first_warning === "string" ? fall.first_warning : null,
      warning_on_since:
        typeof fall.warning_on_since === "string"
          ? fall.warning_on_since
          : null,
      down_then:
        typeof fall.down_then === "number" ? fall.down_then : null,
      within_first_20pct: fall.within_first_20pct === true,
      warnings_before_20pct_mark:
        typeof fall.warnings_before_20pct_mark === "number"
          ? fall.warnings_before_20pct_mark
          : null,
      left_on_from_the_decline_before:
        fall.left_on_from_the_decline_before === true,
    }))
    .filter(
      (fall) =>
        fall.name &&
        fall.peak &&
        fall.low &&
        Number.isFinite(fall.size) &&
        fall.size > 0,
    )
    .sort((left, right) => left.peak.localeCompare(right.peak));

  return {
    falls,
    count: Number(block.count) || falls.length,
    onWithinFirst20Pct:
      typeof block.on_within_first_20pct === "number"
        ? block.on_within_first_20pct
        : null,
    notWithinFirst20Pct:
      typeof block.not_within_first_20pct === "number"
        ? block.not_within_first_20pct
        : null,
  };
}

export function declinesComplete(meta: RegimeMeta | null | undefined) {
  const record = trendRecord(meta);
  return Boolean(
    record &&
      record.falls.length > 0 &&
      record.falls.length === record.count,
  );
}

export function recessionsComplete(atlas: RegimeAtlas | null | undefined) {
  return Boolean(
    atlas &&
      Array.isArray(atlas.crashes) &&
      atlas.crashes.length > 0 &&
      atlas.coverage?.start &&
      atlas.coverage?.end &&
      atlas.crashes.every(
        (crash) => crash.id && crash.name && crash.start && crash.end,
      ),
  );
}

export function findRecession(atlas: RegimeAtlas | null | undefined, id: string) {
  return atlas?.crashes.find((crash) => crash.id === id) ?? null;
}

export function findDecline(
  meta: RegimeMeta | null | undefined,
  id: string,
) {
  return trendRecord(meta)?.falls.find((fall) => fall.id === id) ?? null;
}

function lastAtOrBefore(points: RegimePoint[], date: string) {
  let found: RegimePoint | null = null;
  for (const point of points) {
    if (point.date > date) break;
    found = point;
  }
  return found;
}

function firstAtOrAfter(points: RegimePoint[], date: string) {
  return points.find((point) => point.date >= date) ?? null;
}

function pathAround(
  atlas: RegimeAtlas,
  start: string,
  end: string,
) {
  const points = atlas.timeline ?? [];
  if (points.length === 0) {
    return {
      before: null,
      startPoint: null,
      endPoint: null,
      after: null,
      path: [] as RegimePoint[],
    };
  }
  const beforeDate = addDaysIso(start, -LOOKBACK_DAYS) ?? start;
  const afterDate = addDaysIso(end, LOOKBACK_DAYS) ?? end;
  const before =
    lastAtOrBefore(points, beforeDate) ?? points[0] ?? null;
  const startPoint = firstAtOrAfter(points, start) ?? before;
  const endPoint = lastAtOrBefore(points, end) ?? startPoint;
  const after = firstAtOrAfter(points, afterDate) ?? points.at(-1) ?? null;
  const from = before?.date ?? start;
  const to = after?.date ?? end;
  return {
    before,
    startPoint,
    endPoint,
    after,
    path: points.filter((point) => point.date >= from && point.date <= to),
  };
}

function change(from: number | null | undefined, to: number | null | undefined) {
  if (!Number.isFinite(Number(from)) || !Number.isFinite(Number(to))) {
    return null;
  }
  const start = Number(from);
  return start > 0 ? (Number(to) / start - 1) * 100 : null;
}

export type RecessionFacts = {
  crash: NberWindow;
  drawdown: number | null;
  peakDate: string | null;
  troughDate: string | null;
  coreLow: number | null;
  length: number | null;
  before: RegimePoint | null;
  startPoint: RegimePoint | null;
  endPoint: RegimePoint | null;
  after: RegimePoint | null;
  beforeChange: number | null;
  afterChange: number | null;
  corePath: { date: string; value: number }[];
};

export function recessionFacts(
  atlas: RegimeAtlas,
  crash: NberWindow,
): RecessionFacts {
  const metric = buildCrashMetrics(atlas.timeline, [crash])[0];
  const window = pathAround(atlas, crash.start, crash.end);
  return {
    crash,
    drawdown: metric?.drawdown ?? null,
    peakDate:
      typeof metric?.peak_date === "string" ? metric.peak_date : null,
    troughDate:
      typeof metric?.trough_date === "string" ? metric.trough_date : null,
    coreLow: metric?.score ?? null,
    length:
      typeof crash.duration_days === "number"
        ? crash.duration_days
        : daysBetween(crash.start, crash.end),
    ...window,
    beforeChange: change(
      window.before?.sp500_proxy,
      window.startPoint?.sp500_proxy,
    ),
    afterChange: change(
      window.endPoint?.sp500_proxy,
      window.after?.sp500_proxy,
    ),
    corePath: window.path
      .filter(
        (point) =>
          point.core_index != null && Number.isFinite(Number(point.core_index)),
      )
      .map((point) => ({ date: point.date, value: Number(point.core_index) })),
  };
}

export type DeclineFacts = {
  fall: TrendFall;
  length: number | null;
  drawdown: number;
  coreLow: number | null;
  before: RegimePoint | null;
  startPoint: RegimePoint | null;
  endPoint: RegimePoint | null;
  after: RegimePoint | null;
  beforeChange: number | null;
  afterChange: number | null;
  corePath: { date: string; value: number }[];
};

export function declineFacts(
  atlas: RegimeAtlas | null,
  fall: TrendFall,
): DeclineFacts {
  const window = atlas
    ? pathAround(atlas, fall.peak, fall.low)
    : {
        before: null,
        startPoint: null,
        endPoint: null,
        after: null,
        path: [] as RegimePoint[],
      };
  const scores = window.path
    .map((point) => point.core_index)
    .filter((value) => value != null && Number.isFinite(Number(value)))
    .map(Number);
  return {
    fall,
    length: daysBetween(fall.peak, fall.low),
    drawdown: -fall.size * 100,
    coreLow: scores.length ? Math.min(...scores) : null,
    ...window,
    beforeChange: change(
      window.before?.sp500_proxy,
      window.startPoint?.sp500_proxy,
    ),
    afterChange: change(
      window.endPoint?.sp500_proxy,
      window.after?.sp500_proxy,
    ),
    corePath: window.path
      .filter(
        (point) =>
          point.core_index != null && Number.isFinite(Number(point.core_index)),
      )
      .map((point) => ({ date: point.date, value: Number(point.core_index) })),
  };
}

/** A window page is indexable when its dates and S&P fall are present. */
export function recessionIndexable(facts: RecessionFacts) {
  return Boolean(
    facts.crash.start &&
      facts.crash.end &&
      facts.crash.name &&
      facts.drawdown != null,
  );
}

export function declineIndexable(facts: DeclineFacts) {
  return declineRecordComplete(facts.fall);
}

export function declineRecordComplete(fall: TrendFall) {
  return Boolean(
    fall.peak &&
      fall.low &&
      fall.name &&
      Number.isFinite(fall.size) &&
      fall.size > 0,
  );
}
