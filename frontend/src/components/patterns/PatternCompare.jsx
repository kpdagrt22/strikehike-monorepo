"use client";

/**
 * Study of Patterns, section 03: "Compare today with a past decline", the
 * page's side of the shared case catalogue (GET /api/v1/regime/cases and
 * /cases/{id}/path; Convergence spec §7).
 *
 * At rest one closed row in the Evidence card. Opened: A (Today, through
 * CasePicker's pinned entry, or any case) and B (a past decline), both on the
 * lens market; one sentence and its notes; the aligned chart
 * (AlignedPathsChart) with its Core Index or macro-strength lane; and a toggle
 * between "From each high" (align=peak: today's fall from its latest high
 * against the case's fall from its peak) and "Year into each" (align=latest:
 * the year into today against the year into the case's peak, the case's line
 * after day 0 drawn muted as what followed in that case). The row opens on
 * "Year into each" while today's fall is too young to read on the "From each
 * high" axis (under a tenth of it); the reader's own choice then holds.
 * Descriptive only: every number comes from the payloads; nothing here is
 * called a forecast.
 *
 * This module is small. The picker, the chart and the comparison helpers
 * (about 20 KB gzip) load only when the row comes near the screen or is
 * asked for, so the page's initial JS does not grow.
 *
 * Exports
 *   default, PatternCompare({ engine, assetKey, linkedCase })
 *       The row. `linkedCase` (from /patterns?case={id}) opens it on that case.
 *   watchNextYearLines(engine, onLines) → unsubscribe
 *       "The next year included …" for the engine's setups ("setup:{rank}")
 *       and its mirror ("mirror"), from the catalogue's declines on the
 *       window's own market (rules at followingCases). Loads the catalogue,
 *       and the case paths the rules need, once the page is idle, and calls
 *       onLines(Map) when they are in and whenever they change (a Retry).
 *   useNextYearLines(engine) → Map | null
 *       The same as a hook (null until everything it needs is in).
 *   Map values: { lead, name, detail, more, text }, e.g. lead "The next year
 *   was inside", name "Panic of 1907", detail "(−37.6%, Sep 1906 – Nov 1907)",
 *   more 0, and text the full sentence.
 */

import {
  Fragment,
  lazy,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { finite, formatChange, formatMonth } from "@/components/patterns/patternFormat";
import { ASSET_TARGETS, PATTERN_ASSET_ORDER } from "@/components/regime/assetTargets";

// ------------------------------------------------------------------ code

const CasePicker = lazy(() =>
  import("@/components/regime/CasePicker").then((mod) => ({ default: mod.CasePicker })),
);
const CaseTriggerPlaceholder = lazy(() =>
  import("@/components/regime/CasePicker").then((mod) => ({
    default: mod.CaseTriggerPlaceholder,
  })),
);
const AlignedPathsChart = lazy(() =>
  import("@/components/regime/AlignedPathsChart").then((mod) => ({
    default: mod.AlignedPathsChart,
  })),
);

// One promise for the pure helpers, read with use() inside the panel.
let caseCompareModule = null;
const loadCaseCompare = () => (caseCompareModule ??= import("@/lib/regime/caseCompare"));

function loadPanelCode() {
  return Promise.all([
    loadCaseCompare(),
    import("@/components/regime/CasePicker"),
    import("@/components/regime/AlignedPathsChart"),
  ]);
}

// ------------------------------------------------------------------ data
// JSON kept for the session, keyed like the proxies, read through
// useSyncExternalStore. One request per key at a time; load() never rejects.
// A failed request is kept too: it is asked again only after a Retry (which
// drops it first), so an outage costs one request per key, not one per caller.

const CASES_KEY = "regime-cases";
const NO_ENTRIES = new Map();
let entries = NO_ENTRIES;
const inflight = new Map();
const listeners = new Set();

const store = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: () => entries,
  put(key, entry) {
    entries = new Map(entries);
    entries.set(key, entry);
    listeners.forEach((listener) => listener());
  },
  drop(key) {
    if (!entries.has(key)) return;
    entries = new Map(entries);
    entries.delete(key);
    listeners.forEach((listener) => listener());
  },
  load(key, url, isValid, failure) {
    const entry = entries.get(key);
    if (entry) return Promise.resolve(entry);
    if (inflight.has(key)) return inflight.get(key);
    const request = fetch(url)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.detail || payload?.error || `${failure} (${response.status}).`);
        }
        if (!isValid(payload)) throw new Error(failure);
        return { status: "ready", data: payload };
      })
      .catch((error) => ({ status: "error", error: error?.message || failure }))
      .then((result) => {
        inflight.delete(key);
        store.put(key, result);
        return result;
      });
    inflight.set(key, request);
    return request;
  },
};

const getNoEntries = () => NO_ENTRIES;
const getCasesEntry = () => entries.get(CASES_KEY);
const getNoEntry = () => undefined;

const isCatalogue = (payload) => Array.isArray(payload?.cases) && payload.cases.length > 0;
const isPath = (payload) => Array.isArray(payload?.d) && Array.isArray(payload?.v);

function loadCatalogue() {
  return store.load(CASES_KEY, "/api/v1/regime/cases", isCatalogue, "Case archive is unavailable.");
}

function loadPath(key, url) {
  return store.load(key, url, isPath, "Could not load this path.");
}

/** Run once the page is idle (cancel with the returned function). */
function whenIdle(callback) {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 300);
  return () => window.clearTimeout(id);
}

function daysFrom(fromIso, toIso) {
  return Math.round(
    (Date.parse(`${String(toIso).slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
}

// ------------------------------------------------------- the next year

// A decline whose peak came before a window's next 12 months counts only
// when its fall had barely begun by their start: within 5% of its peak.
const BARELY_BEGUN_PCT = -5;
const VERB = { included: "included", start: "saw the start of", inside: "was inside" };

// The panel's own request for a case on its own series (caseCompare's
// pathKey(id) and pathUrl(id)), so the two share one entry.
const ownPathKey = (id) => `regime-case-path:${id}:own:0:peak`;
const ownPathUrl = (id) => `/api/v1/regime/cases/${encodeURIComponent(id)}/path`;
const pathEntry = (id) => entries.get(ownPathKey(id));

/** A path's level (% from its peak) at the last sample on or before `day`. */
function levelAt(path, day) {
  let level = null;
  for (let i = 0; i < path.d.length && path.d[i] <= day; i += 1) {
    if (finite(path.v[i])) level = Number(path.v[i]);
  }
  return level;
}

/** "9 Oct 2007", as the compare panel writes a case's day; "Sep 1906" for a month-precise case. */
function caseDay(iso, monthly) {
  const day = Number(String(iso).slice(8, 10));
  return monthly || !day ? formatMonth(iso) : `${day} ${formatMonth(iso)}`;
}

/**
 * The catalogue's declines on the window's own market that took part in the
 * 12 months after the window (forward.start to forward.end), earliest peak
 * first, each with its verb:
 *   peak in those months, low in them too   "included"
 *   peak in those months, low after them    "saw the start of"
 *   peak before them, low after them        "was inside"
 *   peak before them, low in them           "included"
 * A decline whose peak came before the months counts only when its fall had
 * barely begun by their start (its own path within 5% of its peak there); a
 * path still loading is listed in `pending`, a failed one leaves it out.
 */
function followingCases(item, cases, asset, pathOf, pending) {
  const start = item?.forward?.start;
  const end = item?.forward?.end;
  if (typeof start !== "string" || typeof end !== "string") return [];
  const found = [];
  for (const c of cases) {
    if (c.series?.key !== asset || typeof c.peak !== "string") continue;
    const low = String(c.trough ?? c.peak);
    if (c.peak > end || low <= start) continue;
    const lowInside = low <= end;
    if (c.peak >= start) {
      found.push({ c, verb: lowInside ? "included" : "start" });
      continue;
    }
    const entry = pathOf(c.id);
    if (!entry) {
      pending.add(c.id);
      continue;
    }
    const level = entry.status === "ready" ? levelAt(entry.data, daysFrom(c.peak, start)) : null;
    if (level != null && level >= BARELY_BEGUN_PCT) {
      found.push({ c, verb: lowInside ? "included" : "inside" });
    }
  }
  return found.sort((x, y) => x.c.peak.localeCompare(y.c.peak));
}

function nextYearLine(found) {
  const [{ c, verb }] = found;
  const monthly = c.series?.precision === "month" || Boolean(c.flags?.month_precise);
  const open = c.recovery_status === "not_recovered";
  const detail = `(${formatChange(c.depth_pct)}${open ? " so far" : ""}, ${caseDay(c.peak, monthly)} – ${caseDay(c.trough ?? c.peak, monthly)})`;
  const lead = `The next year ${VERB[verb]}`;
  const more = found.length - 1;
  return {
    lead,
    name: c.name,
    detail,
    more,
    text: `${lead} the ${c.name} ${detail}${more > 0 ? `, and ${more} more` : ""}.`,
  };
}

function linesFor(engine, cases, pathOf) {
  const lines = new Map();
  const pending = new Set();
  const asset = engine?.asset;
  if (!asset || !Array.isArray(cases)) return { lines, pending };
  const add = (key, item) => {
    const found = followingCases(item, cases, asset, pathOf, pending);
    if (found.length) lines.set(key, nextYearLine(found));
  };
  for (const analog of engine.analogs ?? []) add(`setup:${analog.rank}`, analog);
  if (engine.mirror?.available === true && engine.mirror.exact) add("mirror", engine.mirror.exact);
  return { lines, pending };
}

export function watchNextYearLines(engine, onLines) {
  let last = null;
  const update = () => {
    const entry = entries.get(CASES_KEY);
    if (entry?.status !== "ready") return;
    const found = linesFor(engine, entry.data.cases, pathEntry);
    if (found.pending.size) {
      for (const id of found.pending) loadPath(ownPathKey(id), ownPathUrl(id));
      return;
    }
    const key = [...found.lines].map(([item, line]) => `${item}=${line.text}`).join("|");
    if (key === last) return;
    last = key;
    onLines(found.lines);
  };
  const unsubscribe = store.subscribe(update);
  const cancel = whenIdle(() => {
    loadCatalogue();
    update();
  });
  return () => {
    cancel();
    unsubscribe();
  };
}

export function useNextYearLines(engine) {
  const all = useSyncExternalStore(store.subscribe, store.snapshot, getNoEntries);
  const found = useMemo(() => {
    const entry = all.get(CASES_KEY);
    if (!engine || entry?.status !== "ready") return null;
    return linesFor(engine, entry.data.cases, (id) => all.get(ownPathKey(id)));
  }, [engine, all]);
  const waiting = found ? [...found.pending].join(" ") : "";
  useEffect(() => {
    if (!engine) return undefined;
    return whenIdle(() => {
      loadCatalogue();
    });
  }, [engine]);
  useEffect(() => {
    for (const id of waiting ? waiting.split(" ") : []) loadPath(ownPathKey(id), ownPathUrl(id));
  }, [waiting]);
  return found && !found.pending.size ? found.lines : null;
}

// ------------------------------------------------------------ the cases

/** A case the lens market's data covers (measured on it, or carrying it). */
function availableOn(c, asset) {
  return Boolean(c) && (c.series?.key === asset || (c.series_available ?? []).includes(asset));
}

/** The lens market's open decline, if any: today is inside it. */
function openCaseOn(cases, asset) {
  return (
    cases.find(
      (c) =>
        c.series?.key === asset &&
        (c.recovery_status === "not_recovered" || Boolean(c.flags?.open)),
    ) ?? null
  );
}

/** The catalogue's default case when it is on this market, else the market's deepest curated decline. */
function defaultCaseFor(data, asset) {
  const cases = data?.cases ?? [];
  const preferred = cases.find((c) => c.id === data?.default_pair?.a);
  if (preferred?.series?.key === asset) return preferred;
  const own = cases
    .filter((c) => c.series?.key === asset && c.recovery_status !== "not_recovered")
    .sort(
      (x, y) =>
        Number(y.name_source === "curated") - Number(x.name_source === "curated") ||
        Math.abs(y.depth_pct) - Math.abs(x.depth_pct),
    );
  return own[0] ?? cases.find((c) => availableOn(c, asset)) ?? null;
}

/** The case the row opens on: a valid deep link on this lens, else the default. */
function openingCaseFor(data, asset, linkedCase) {
  const linked = (data?.cases ?? []).find((c) => c.id === linkedCase);
  const open = data ? openCaseOn(data.cases, asset) : null;
  return linked && availableOn(linked, asset) && linked.id !== open?.id
    ? linked
    : defaultCaseFor(data, asset);
}

/**
 * Whether the row opens on "Year into each": today's fall (its days since the
 * latest high) fills under a tenth of the "From each high" axis against the
 * case it opens on, so its line would be a stub there.
 */
function opensOnYearInto(todayPath, c) {
  const last = todayPath?.d?.[todayPath.d.length - 1];
  if (!Number.isFinite(last) || !c) return false;
  return last < 0.1 * Math.max(45, Math.ceil(1.15 * Math.max(last, c.days_to_trough ?? 0)));
}

/**
 * Today as a case, from GET /cases/today/path?series={asset} (align=peak):
 * the latest high, the lowest close since (the low so far) and the latest
 * close. Shaped like a catalogue case so the shared helpers read it.
 */
function todayCase(cc, path, asset) {
  const d = path.d;
  const v = path.v;
  let low = 0;
  for (let i = 1; i < d.length; i += 1) {
    if (v[i] != null && (v[low] == null || v[i] < v[low])) low = i;
  }
  const monthly = path.resolution === "monthly";
  const ci = Array.isArray(path.ci) ? path.ci : null;
  const ms = Array.isArray(path.ms) ? path.ms : null;
  return {
    id: "today",
    name: "Today",
    short_name: "Today",
    name_source: "curated",
    series: {
      key: asset,
      label: path.series_label,
      resolution: path.resolution,
      precision: monthly ? "month" : "day",
    },
    peak: path.t0,
    trough: cc.addDays(path.t0, d[low]),
    depth_pct: Math.round(Number(v[low] ?? 0) * 10) / 10,
    days_to_trough: d[low],
    days_to_recovery: null,
    recovery_status: "not_recovered",
    latest: { date: path.last_obs, pct_from_peak: path.current_pct_from_peak },
    core_index: ci && ci[0] != null ? { at_peak: ci[0], at_trough: ci[low] ?? null } : null,
    macro_strength:
      ms && ms[0] != null
        ? {
            at_peak: { value: ms[0], coverage: 1 },
            at_trough: { value: ms[low] ?? null, coverage: 1 },
          }
        : null,
    events: [],
    recessions: [],
    flags: { open: true },
    series_available: [asset],
    lastDay: d[d.length - 1] ?? 0,
  };
}

/**
 * The series a side's line is drawn on, in prose ("the S&P 500", "the S&P 90",
 * "the Cowles US stock index (monthly average)"), from the catalogue, so the
 * note under the sentence is known when the case is picked: a case measured
 * on the lens market is drawn on its own series, any other case on the lens
 * market's series around its dates (today's).
 */
function sideSeries(cc, c, asset, today) {
  if (!c) return null;
  if (c.id === "today" || cc.requestSeries(c, asset) === "own") return cc.seriesName(c);
  return today ? cc.seriesName(today) : null;
}

/** Whether a side's year before day 0 starts before its series does ("no data a year before day 0"). */
function yearBeforeMissing(c, series, coverage) {
  if (!c || c.id === "today" || typeof c.peak !== "string") return false;
  const key = series === "own" ? c.series?.key : series;
  const first = coverage?.series_first_obs?.[key];
  if (!first) return false;
  const reach = series === "own" && c.series?.resolution === "monthly" ? 31 : 7;
  return daysFrom(c.peak, first) > -365 + reach;
}

/**
 * The change over the year into day 0, from a path requested from day −365:
 * a number, null when the series starts later, undefined while it loads.
 */
function yearChange(entry) {
  const path = entry?.status === "ready" ? entry.data : null;
  if (!path) return undefined;
  const first = path.d?.[0];
  const reach = path.resolution === "monthly" ? 31 : 7;
  const base = finite(first) && first <= -365 + reach ? Number(path.v?.[0]) : NaN;
  if (!Number.isFinite(base) || base <= -100) return null;
  return (100 / (100 + base) - 1) * 100;
}

// ------------------------------------------------------------- the read

function subject(side, text) {
  return { kind: "subject", side, text };
}

function words(text) {
  return { kind: "text", text };
}

function num(text) {
  return { kind: "num", text };
}

/**
 * "Over the year into each, Today rose 12.3% and GFC rose 15.9%." When a side
 * is drawn on the lens market around its own dates (a case measured on
 * another market), the read names that market first, as the "From each high"
 * read does: "Through US stocks, over the year into each: …".
 */
function yearIntoTokens(cc, sides, through = null) {
  const parts = sides.map(({ key, c, entry, missing }) => {
    if (entry?.status === "error") return null;
    const change = missing ? null : yearChange(entry);
    if (change === null) return [subject(key, c.short_name), words(": no data a year before day 0")];
    if (change === undefined) return [subject(key, c.short_name), words(" rose "), num("00.0%")];
    return [subject(key, c.short_name), words(change >= 0 ? " rose " : " fell "), num(cc.formatAbsPct(change))];
  });
  const shown = parts.filter(Boolean);
  if (!shown.length) return [];
  return [
    words(through ? `Through ${through}, over the year into each: ` : "Over the year into each, "),
    ...shown.flatMap((part, index) => (index ? [words(" and "), ...part] : part)),
    words("."),
  ];
}

/** Today at its high: there is no fall to compare yet. */
function atHighTokens(cc, today, todayKey, other, otherKey, otherEntry) {
  const path = otherEntry?.status === "ready" ? otherEntry.data : null;
  const value = path ? cc.valueAt(path.d, path.v, other.days_to_trough) : null;
  return [
    subject(todayKey, "Today"),
    words(" is at its high of "),
    num(cc.formatCaseDate(today.peak, today.series.precision)),
    words("; "),
    subject(otherKey, other.short_name),
    words(value != null && value >= 0 ? " rose " : " fell "),
    num(value == null ? "00.0%" : cc.formatAbsPct(value)),
    words(" from its peak to its low."),
  ];
}

/** Today's fall is still open: "Today fell 2.5% so far". */
function withSoFar(tokens, todayKey) {
  const at = tokens.findIndex((token) => token.kind === "subject" && token.side === todayKey);
  if (at < 0 || tokens[at + 2]?.kind !== "num") return tokens;
  return [...tokens.slice(0, at + 3), words(" so far"), ...tokens.slice(at + 3)];
}

function Sentence({ tokens }) {
  return tokens.map((token, index) => {
    if (token.kind === "subject") {
      return (
        <span key={index} className={`font-semibold ${SIDE_INK[token.side] ?? ""}`}>
          {token.text}
        </span>
      );
    }
    if (token.kind === "num") {
      return (
        <span
          key={index}
          className="whitespace-nowrap font-mono text-[0.94em] tabular-nums text-[#14121a] dark:text-[#f2ede4]"
        >
          {token.text}
        </span>
      );
    }
    return <Fragment key={index}>{token.text}</Fragment>;
  });
}

// ------------------------------------------------------------- the look

const SIDE_INK = {
  a: "text-[#14121a] dark:text-[#f2ede4]",
  b: "text-[#c0442f] dark:text-[#ff8b77]",
};

const SEGMENT =
  "inline-flex shrink-0 items-center gap-0.5 rounded-full border border-(--sh-line-1) bg-black/[0.025] p-0.5 dark:bg-white/[0.035]";
// On coarse pointers the hit area grows to 45 px through ::before.
const SEGMENT_BUTTON =
  "relative rounded-full px-2.5 py-1 text-micro font-medium transition-colors duration-(--sh-dur-micro) motion-reduce:transition-none pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-[11px] pointer-coarse:before:content-['']";
const SEGMENT_IDLE =
  "text-black/60 hover:text-black/75 focus-visible:text-black/75 dark:text-white/60 dark:hover:text-white/75 dark:focus-visible:text-white/75";

// The same summary as the other Evidence rows (PatternMirror's DisclosureRow).
const SUMMARY =
  "group/summary flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-1 [&::-webkit-details-marker]:hidden";
const SUMMARY_LABEL =
  "text-micro font-medium uppercase tracking-[0.16em] text-(--sh-text-3) transition-colors duration-(--sh-dur-micro) group-hover/summary:text-(--sh-text-1) group-focus-visible/summary:text-(--sh-text-1) motion-reduce:transition-none";

// The sentence and its notes take their own height: everything in them is
// known when a case or view is picked (a path still loading holds a number
// of the same width), so nothing moves when the paths arrive. Only before
// the catalogue and today's path are in do the read and the day-0 line hold
// the lens's default (S&P 500: Year into each against the GFC; Nifty 50:
// From each high against the GFC on the Nifty, with its open-case note), as
// measured at each width, so their late arrival moves nothing below.
const READ_BOX = "relative mt-3.5 max-w-[62rem]";
const READ_TEXT =
  "text-strong leading-[1.55] tracking-[-0.005em] text-(--sh-text-1) sm:text-[1.0625rem]";
const NOTE_TEXT = "mt-1 text-micro leading-[1.35] text-(--sh-text-3)";
const READ_RESERVE = {
  sp500: "min-h-[43.4px] min-[484px]:min-h-[21.7px] sm:min-h-[26.35px]",
  nifty:
    "min-h-[83.95px] min-[398px]:min-h-[62.25px] sm:min-h-[71.55px] min-[880px]:min-h-[45.2px] lg:min-h-[46.55px]",
};
const DAY_ZERO = "relative mt-1 text-micro leading-[1.35] text-(--sh-text-3)";
const DAY_ZERO_RESERVE = {
  sp500:
    "min-h-[44.55px] min-[370px]:min-h-[29.7px] min-[630px]:min-h-[14.85px] sm:min-h-[29.7px] min-[658px]:min-h-[14.85px] lg:min-h-[16.2px]",
  nifty: "min-h-[29.7px] min-[427px]:min-h-[14.85px] lg:min-h-[16.2px]",
};

const CORE_INDEX_DEFINITION = (
  <>
    Core Index is a weekly trend-and-stress reading of the S&amp;P 500 from
    −50 to +50, read as a contrarian sentiment map. A high score means
    euphoria and elevated risk, a low score means fear and accumulation. It is
    not a directional prediction.
    <span className="mt-1.5 block font-mono text-(--sh-text-3)">
      +25 Risk Elevated · 0 · −25 Maximum Fear
    </span>
  </>
);
const MACRO_DEFINITION = (
  <>
    Macro strength is the 0–100 macro meter used on the Regime page: 60 and
    above reads favorable, 40 and below disruptive, neutral between.
  </>
);

const ALIGN_OPTIONS = [
  { key: "peak", label: "From each high" },
  { key: "latest", label: "Year into each" },
];

function AlignToggle({ value, onChange }) {
  const refs = useRef([]);
  const index = Math.max(0, ALIGN_OPTIONS.findIndex((option) => option.key === value));
  const handleKey = (event) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + ALIGN_OPTIONS.length) % ALIGN_OPTIONS.length;
    onChange(ALIGN_OPTIONS[next].key);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Align" className={SEGMENT}>
      {ALIGN_OPTIONS.map((option, position) => {
        const checked = option.key === value;
        return (
          <button
            key={option.key}
            ref={(node) => {
              refs.current[position] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.key)}
            onKeyDown={handleKey}
            className={`${SEGMENT_BUTTON} ${
              checked ? "bg-white/80 text-[#14121a] dark:bg-white/10 dark:text-[#f2ede4]" : SEGMENT_IDLE
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * While the panel's code loads: the bar, the read and the chart at their
 * measured heights (the chart is 470 px while its plot is under 560 px wide,
 * 520 from 634 px, 436 from 640, 486 from 658, 487 from 1024 and 447 from
 * 1280), so its late arrival moves nothing below it.
 */
function PanelSkeleton({ asset }) {
  return (
    <div aria-hidden="true">
      <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
        <div className="h-[60px] rounded-[14px] bg-(--sh-hover) sm:h-12" />
        <div className="h-[60px] rounded-[14px] bg-(--sh-hover) sm:h-12" />
      </div>
      <div className={`${READ_BOX} ${READ_RESERVE[asset]}`} />
      <div className="mt-3 h-[470px] min-[634px]:h-[520px] sm:h-[436px] min-[658px]:h-[486px] lg:h-[487px] xl:h-[447px]" />
      <div className={`${DAY_ZERO} ${DAY_ZERO_RESERVE[asset]}`} />
    </div>
  );
}

// ------------------------------------------------------------ the panel

function ComparePanel({ asset, choice, onChoose, onAlign, onSettled, announce }) {
  const cc = use(loadCaseCompare());
  const all = useSyncExternalStore(store.subscribe, store.snapshot, getNoEntries);
  const casesEntry = useSyncExternalStore(store.subscribe, getCasesEntry, getNoEntry);
  const [attempts, setAttempts] = useState(0);
  const previewTimer = useRef(0);

  const data = casesEntry?.status === "ready" ? casesEntry.data : null;
  const coverage = data?.coverage ?? null;
  const target = ASSET_TARGETS[asset] ?? ASSET_TARGETS.sp500;

  const byId = useMemo(() => new Map((data?.cases ?? []).map((c) => [c.id, c])), [data]);
  const recessionsById = useMemo(
    () => new Map((data?.recessions ?? []).map((r) => [r.id, r])),
    [data],
  );
  const openCase = useMemo(() => (data ? openCaseOn(data.cases, asset) : null), [data, asset]);
  // The lens market's open decline is today itself: it is not a past case.
  const filter = useCallback(
    (c) => availableOn(c, asset) && c.id !== openCase?.id,
    [asset, openCase],
  );
  const fallback = useMemo(() => (data ? defaultCaseFor(data, asset) : null), [data, asset]);

  // Today's paths: from the latest high (the pinned entry, the low so far)
  // and, for "Year into each", the year into the latest close.
  const peakKey = cc.pathKey("today", asset, 0, "peak");
  const peakUrl = cc.pathUrl("today", { series: asset });
  const peakEntry = useSyncExternalStore(store.subscribe, () => entries.get(peakKey), getNoEntry);
  const peakPath = peakEntry?.status === "ready" ? peakEntry.data : null;
  const today = useMemo(
    () => (peakPath ? todayCase(cc, peakPath, asset) : null),
    [cc, peakPath, asset],
  );

  // The view: the reader's, else the one the row opens on for this lens.
  const align =
    choice.align ??
    (opensOnYearInto(peakPath, openingCaseFor(data, asset, choice.first)) ? "latest" : "peak");
  const latest = align === "latest";
  // Until today's path is in, the view is not known: ask for the sides then.
  const viewKnown = choice.align != null || (data != null && peakEntry != null);

  // The sides in effect: the reader's choice where this lens has it.
  const valid = (id) => id === "today" || (byId.has(id) && filter(byId.get(id)));
  let a = valid(choice.a) ? choice.a : "today";
  let b = choice.b && valid(choice.b) ? choice.b : fallback?.id ?? null;
  if (a === b) b = a === "today" ? fallback?.id ?? null : "today";
  const caseOf = (id) => (id === "today" ? today : byId.get(id) ?? null);
  const caseA = caseOf(a);
  const caseB = caseOf(b);
  const todayKey = a === "today" ? "a" : b === "today" ? "b" : null;

  const request = (id) => {
    if (!id || !viewKnown) return null;
    if (id === "today") {
      return latest
        ? {
            key: cc.pathKey("today", asset, -365, "latest"),
            url: cc.pathUrl("today", { series: asset, from: -365, align: "latest" }),
          }
        : { key: peakKey, url: peakUrl };
    }
    const c = byId.get(id);
    if (!c) return null;
    const series = cc.requestSeries(c, asset);
    const from = latest ? -365 : 0;
    return { key: cc.pathKey(id, series, from), url: cc.pathUrl(id, { series, from }) };
  };
  const reqA = request(a);
  const reqB = request(b);
  const keyA = reqA?.key ?? null;
  const urlA = reqA?.url ?? null;
  const keyB = reqB?.key ?? null;
  const urlB = reqB?.url ?? null;
  const entryA = keyA ? all.get(keyA) : undefined;
  const entryB = keyB ? all.get(keyB) : undefined;

  // The keys name the requests; `attempts` re-runs them after a Retry.
  useEffect(() => {
    loadCatalogue();
    loadPath(peakKey, peakUrl);
    if (keyA) loadPath(keyA, urlA);
    if (keyB) loadPath(keyB, urlB);
  }, [peakKey, peakUrl, keyA, urlA, keyB, urlB, attempts]);

  // The other lens's today, so a lens switch reads at once.
  useEffect(
    () =>
      whenIdle(() => {
        for (const key of PATTERN_ASSET_ORDER) {
          if (key !== asset) {
            loadPath(cc.pathKey("today", key, 0, "peak"), cc.pathUrl("today", { series: key }));
          }
        }
      }),
    [cc, asset],
  );

  useEffect(() => () => window.clearTimeout(previewTimer.current), []);

  // Prefetch the case under the picker's active option.
  const preview = useCallback(
    (id) => {
      window.clearTimeout(previewTimer.current);
      if (!id || id === "today") return;
      previewTimer.current = window.setTimeout(() => {
        const c = byId.get(id);
        if (!c) return;
        const series = cc.requestSeries(c, asset);
        const from = latest ? -365 : 0;
        loadPath(cc.pathKey(id, series, from), cc.pathUrl(id, { series, from }));
      }, 150);
    },
    [byId, cc, asset, latest],
  );

  const retry = (key) => {
    store.drop(key);
    setAttempts((value) => value + 1);
  };

  const pinned = usePinnedToday(cc, today, peakPath, target, openCase);
  const ready = Boolean(data && caseA && caseB);

  // ---- the read
  const statusOf = (entry) => (entry ? entry.status : "loading");
  const seriesA = caseA && a !== "today" ? cc.requestSeries(caseA, asset) : "own";
  const seriesB = caseB && b !== "today" ? cc.requestSeries(caseB, asset) : "own";
  // A case measured on another market is drawn on the lens market around its
  // dates: every figure for it is the lens market's, and the read says so.
  const lensWords = cc.seriesLabel(asset, "sentence");
  const crossMarket = seriesA !== "own" || seriesB !== "own";
  let tokens = [];
  let complete = false;
  if (ready) {
    const sides = [
      { key: "a", c: caseA, entry: entryA, missing: yearBeforeMissing(caseA, seriesA, coverage) },
      { key: "b", c: caseB, entry: entryB, missing: yearBeforeMissing(caseB, seriesB, coverage) },
    ];
    const bothOwn = !todayKey && seriesA === "own" && seriesB === "own";
    if (latest) {
      tokens = yearIntoTokens(cc, sides, crossMarket ? lensWords : null);
      complete = Boolean(entryA && entryB);
    } else if (bothOwn) {
      tokens = cc.describePair(caseA, caseB, { coverage: coverage ?? {} }).tokens;
      complete = true;
    } else if (todayKey && today.depth_pct > -0.05) {
      const otherKey = todayKey === "a" ? "b" : "a";
      tokens = atHighTokens(cc, today, todayKey, otherKey === "a" ? caseA : caseB, otherKey, otherKey === "a" ? entryA : entryB);
      complete = Boolean(otherKey === "a" ? entryA : entryB);
    } else {
      tokens = cc.describePair(caseA, caseB, {
        series: asset,
        paths: {
          a: entryA?.status === "ready" ? entryA.data : null,
          b: entryB?.status === "ready" ? entryB.data : null,
        },
        coverage: coverage ?? {},
        status: { a: statusOf(entryA), b: statusOf(entryB) },
      }).tokens;
      if (todayKey) tokens = withSoFar(tokens, todayKey);
      complete = Boolean(entryA && entryB);
    }
  }
  const readKey = `${asset}|${a}|${b}|${align}|${complete ? "read" : "wait"}`;
  const settled = casesEntry?.status === "error" || (ready && complete);

  useEffect(() => {
    if (settled) onSettled();
  }, [settled, onSettled]);

  // ---- the notes under the sentence, and the line under the chart
  const domain = latest
    ? [-365, 365]
    : [
        0,
        Math.max(
          45,
          Math.ceil(
            1.15 *
              Math.max(
                (a === "today" ? today?.lastDay : caseA?.days_to_trough) ?? 0,
                (b === "today" ? today?.lastDay : caseB?.days_to_trough) ?? 0,
              ),
          ),
        ),
      ];

  const notes = [];
  if (choice.linked && choice.b === choice.linked && b !== choice.linked && data && caseB) {
    const asked = byId.get(choice.linked);
    if (!asked) notes.push(`That case is not in the archive; showing the ${caseB.name}.`);
    else if (asked.id !== openCase?.id) {
      notes.push(`The ${asked.name} has no ${target.label} data; showing the ${caseB.name}.`);
    }
  }
  if (openCase && todayKey) notes.push(`Today is inside the ${openCase.name}.`);
  if (ready) {
    const seriesWordsA = sideSeries(cc, caseA, asset, today);
    const seriesWordsB = sideSeries(cc, caseB, asset, today);
    if (seriesWordsA && seriesWordsB && seriesWordsA !== seriesWordsB) {
      notes.push(`A on ${seriesWordsA}, B on ${seriesWordsB}.`);
    }
    // Known from the catalogue at the pick, so the note never arrives late.
    if (seriesA !== "own") notes.push(`A shows ${lensWords} around ${caseA.short_name}’s dates.`);
    if (seriesB !== "own") notes.push(`B shows ${lensWords} around ${caseB.short_name}’s dates.`);
  }

  let dayZero = "";
  if (ready) {
    const when = (c) => cc.formatCaseDate(c.peak, c.series?.precision);
    if (latest && todayKey) {
      // Day 0 for today is its latest close (the year-into path's t0), known
      // from the high's path already, so this line is final on the toggle.
      const other = todayKey === "a" ? caseB : caseA;
      const otherSeries = todayKey === "a" ? seriesB : seriesA;
      const followed =
        otherSeries !== "own"
          ? `what ${lensWords} did after ${other.short_name}’s peak`
          : `what followed in ${other.short_name}`;
      dayZero = `Day 0 is today, ${cc.formatCaseDate(today.latest.date, today.series.precision)}, and ${other.short_name}’s peak, ${when(other)}. After day 0, the muted line is ${followed}.`;
    } else if (todayKey) {
      const other = todayKey === "a" ? caseB : caseA;
      dayZero = `Day 0 is each high: ${when(today)} for Today, ${when(other)} for ${other.short_name}.`;
    } else {
      dayZero = `Day 0 is each peak: ${when(caseA)} for ${caseA.short_name}, ${when(caseB)} for ${caseB.short_name}.${latest ? " Each line runs a year either side of it." : ""}`;
    }
  }

  // ---- the chart
  const ownA = a === "today" || seriesA === "own";
  const ownB = b === "today" || seriesB === "own";
  const markers = Boolean(ownA && ownB);
  const lane = ready ? cc.chooseLaneMeasure(caseA, caseB, coverage ?? {}) : null;
  // Each side's lane reading at day 0 (its peak; today's latest close), from
  // the catalogue and today's path: "+15.8 at day 0".
  const laneAtZero = (id, c) => {
    const key = lane?.key;
    if (!key || !c) return null;
    let value;
    if (id === "today") {
      const values = peakPath?.[key];
      value = Array.isArray(values) ? values[values.length - 1] : null;
    } else {
      value = key === "ms" ? c.macro_strength?.at_peak?.value : c.core_index?.at_peak;
    }
    if (!finite(value)) return null;
    return `${key === "ms" ? Math.round(Number(value)) : cc.formatSignedValue(value)} at day 0`;
  };
  const zero = latest && lane ? { a: laneAtZero(a, caseA), b: laneAtZero(b, caseB) } : null;
  // The year-into rest readout, for AlignedPathsChart's `rest` override.
  const restPct = (entry, missing) => {
    const change = missing ? null : yearChange(entry);
    return change == null ? "—" : cc.formatPct(change);
  };
  const rest = latest
    ? {
        label: "Year into day 0",
        a: restPct(entryA, yearBeforeMissing(caseA, seriesA, coverage)),
        b: restPct(entryB, yearBeforeMissing(caseB, seriesB, coverage)),
        lane: zero,
      }
    : undefined;
  const sideSpec = (key, id, c, entry, req) => {
    const isToday = id === "today";
    const path = entry?.status === "ready" ? entry.data : null;
    let low = null;
    // In "Year into each" a low beyond the plot is left out of the readout.
    if (c && !(isToday && latest) && (!latest || c.days_to_trough <= domain[1])) {
      low = markers
        ? { d: c.days_to_trough, v: c.depth_pct, open: isToday || cc.isOpen(c) }
        : { d: c.days_to_trough, v: path ? cc.valueAt(path.d, path.v, c.days_to_trough) ?? 0 : 0 };
    }
    return {
      key,
      letter: key.toUpperCase(),
      short: c?.short_name ?? (key === "a" ? "case A" : "case B"),
      status: entry ? entry.status : "loading",
      path,
      error: entry?.status === "error" ? entry.error : null,
      onRetry: () => (req ? retry(req.key) : undefined),
      // The line, its crosshair values and its lane end at the series' last
      // observation: nothing is read past the data (today's line stops at
      // its latest close, never runs into a future date).
      stop: path?.d?.length ? path.d[path.d.length - 1] : null,
      low,
      recovery:
        markers && !isToday && Number.isFinite(c?.days_to_recovery) ? { d: c.days_to_recovery } : null,
      events: isToday ? [] : c?.events ?? [],
      recessions: isToday || !c ? [] : cc.recessionsFor(c, recessionsById),
      drawToken: choice.draw[key],
      laneAt:
        c && !latest
          ? lane?.key === "ms"
            ? { peak: c.macro_strength?.at_peak?.value ?? null, low: c.macro_strength?.at_trough?.value ?? null }
            : { peak: c.core_index?.at_peak ?? null, low: c.core_index?.at_trough ?? null }
          : undefined,
      muteAfter: latest && todayKey && key !== todayKey ? 0 : undefined,
    };
  };
  const sides = [sideSpec("a", a, caseA, entryA, reqA), sideSpec("b", b, caseB, entryB, reqB)];
  const caption = latest
    ? todayKey
      ? `from today (${todayKey.toUpperCase()}) and the peak (${todayKey === "a" ? "B" : "A"})`
      : "from each peak"
    : todayKey
      ? "from each high"
      : "from each peak";

  const choose = (side, id) => {
    const other = side === "a" ? "b" : "a";
    const current = { a, b };
    if (current[side] === id) return;
    if (current[other] === id) {
      onChoose({ a: current.b, b: current.a }, []);
      announce("Swapped A and B.");
      return;
    }
    onChoose({ ...current, [side]: id }, [side]);
  };

  if (casesEntry?.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 py-2 text-meta text-(--sh-text-2)">
        <span>{casesEntry.error}</span>
        <button
          type="button"
          onClick={() => retry(CASES_KEY)}
          className="rounded-full border border-(--sh-line-2) px-3 py-1 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) pointer-coarse:min-h-11"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2 sm:gap-3">
        {ready && pinned ? (
          <>
            <CasePicker
              side="a"
              label="Case A"
              value={a}
              otherValue={b}
              cases={data.cases}
              kinds={data.kinds}
              recessions={data.recessions}
              pinned={pinned}
              coverage={coverage}
              filter={filter}
              onChange={(id) => choose("a", id)}
              onPreview={preview}
            />
            <CasePicker
              side="b"
              label="Case B"
              value={b}
              otherValue={a}
              cases={data.cases}
              kinds={data.kinds}
              recessions={data.recessions}
              pinned={pinned}
              coverage={coverage}
              filter={filter}
              onChange={(id) => choose("b", id)}
              onPreview={preview}
            />
          </>
        ) : (
          <>
            <CaseTriggerPlaceholder side="a" />
            <CaseTriggerPlaceholder side="b" />
          </>
        )}
      </div>

      {/* The sentence is held invisible (sized with placeholders) until both
          paths are in, then shown; each change mounts new text. Its notes
          follow it in the same box. */}
      <div className={`${READ_BOX}${tokens.length ? "" : ` ${READ_RESERVE[asset]}`}`}>
        <p aria-live="polite" aria-atomic="true" className={READ_TEXT}>
          {tokens.length ? (
            <span key={readKey} className={complete ? undefined : "invisible"}>
              <Sentence tokens={tokens} />
            </span>
          ) : null}
        </p>
        {notes.length ? (
          <p key={notes.join(" ")} className={NOTE_TEXT}>
            {notes.join(" ")}
          </p>
        ) : null}
      </div>

      <div className="mt-3">
        <PanelChart
          sides={sides}
          domain={domain}
          zeroLabel={latest && todayKey ? "today" : todayKey ? "high" : "peak"}
          caption={caption}
          markers={markers}
          lane={lane ?? { key: "ci", label: "Core Index", notes: { a: null, b: null } }}
          zero={zero}
          laneDefinition={lane?.key === "ms" ? MACRO_DEFINITION : CORE_INDEX_DEFINITION}
          rest={rest}
          ariaLabel={
            ready
              ? `${latest ? "The year into each day 0 and the year after" : "Change from each high"}, ${target.label} lens: ${caseA.name} (A) and ${caseB.name} (B).`
              : "Change from each high."
          }
          scrubLabel={latest && todayKey ? "Day from today and from the peak" : "Day from each high"}
          gapNote={
            coverage?.equity_gap?.end ? `no equity data to ${cc.formatMonth(coverage.equity_gap.end)}` : null
          }
          controls={
            <div className="flex items-center xl:justify-end">
              <AlignToggle value={align} onChange={onAlign} />
            </div>
          }
        />
      </div>
      <p className={`${DAY_ZERO}${dayZero ? "" : ` ${DAY_ZERO_RESERVE[asset]}`}`}>
        <span key={dayZero}>{dayZero}</span>
      </p>
    </div>
  );
}

/**
 * The shared chart, with its lane's line at rest in "Year into each" reading
 * each side at day 0 (`zero`; a side without the measure keeps its note), not
 * a low the plot may not reach. The state is its own, so the crosshair's
 * coming and going re-renders the chart, not the panel.
 */
function PanelChart({ lane, zero, ...props }) {
  const [atRest, setAtRest] = useState(true);
  const onDayChange = useCallback((day) => setAtRest(day == null), []);
  const shown =
    zero && atRest
      ? { ...lane, notes: { a: lane.notes?.a ?? zero.a, b: lane.notes?.b ?? zero.b } }
      : lane;
  return <AlignedPathsChart {...props} lane={shown} onDayChange={onDayChange} headingLevel={3} />;
}

/** The pinned Today entry: "S&P 500 · −1.2% from 6 Oct 2026". */
function usePinnedToday(cc, today, path, target, openCase) {
  return useMemo(() => {
    if (!today || !path) return null;
    const current = Number(path.current_pct_from_peak);
    const high = cc.formatCaseDate(today.peak, today.series.precision);
    const atHigh = !Number.isFinite(current) || current > -0.05;
    const subline = atHigh ? `${target.label} · at its high of ${high}` : `${target.label} · ${cc.formatPct(current)} from ${high}`;
    const lastDate = cc.formatCaseDate(path.last_obs, today.series.precision);
    const description = atHigh
      ? `The ${target.label} at its high of ${high} on ${lastDate}.`
      : `The ${target.label} ${cc.formatAbsPct(current)} below its high of ${high} on ${lastDate}; its lowest close since was ${cc.formatPct(today.depth_pct)}, on ${cc.formatCaseDate(today.trough, today.series.precision)}.${
          openCase ? ` Today is inside the ${openCase.name}.` : ""
        }`;
    return [{ id: "today", name: "Today", short: "Today", subline, description }];
  }, [cc, today, path, target, openCase]);
}

// -------------------------------------------------------------- the row

/**
 * The closed row (Evidence slot) and, once opened, the panel. Its code and
 * data start loading when the row comes within reach of the screen, or on
 * hover, focus or a press, so opening is usually instant.
 */
export function PatternCompare({ engine, assetKey, linkedCase: linkedId = null }) {
  // Any deep link opens the row and brings it into view; "today" is side A
  // already, so ?case=today opens it on the default pair, with no note.
  const linkedCase = linkedId === "today" ? null : linkedId;
  const asset = ASSET_TARGETS[assetKey] ? assetKey : "sp500";
  const rowRef = useRef(null);
  const scrolledRef = useRef(false);
  const [open, setOpen] = useState(Boolean(linkedId));
  const [settled, setSettled] = useState(false);
  const [choice, setChoice] = useState(() => ({
    a: "today",
    b: linkedCase,
    // null: the view the row opens on for the lens; then the reader's.
    align: null,
    draw: { a: 0, b: 0 },
    linked: linkedCase,
    first: linkedCase,
  }));
  // The reader's view, for the prefetch (which runs outside render).
  const alignRef = useRef(choice.align);
  useEffect(() => {
    alignRef.current = choice.align;
  }, [choice.align]);
  const [announcement, setAnnouncement] = useState({ text: "", n: 0 });
  const casesEntry = useSyncExternalStore(store.subscribe, getCasesEntry, getNoEntry);

  const count = useMemo(() => {
    const cases = casesEntry?.status === "ready" ? casesEntry.data.cases : null;
    if (!cases) return null;
    const openCase = openCaseOn(cases, asset);
    return cases.filter((c) => availableOn(c, asset) && c.id !== openCase?.id).length;
  }, [casesEntry, asset]);

  // The catalogue, today's path and the paths of the view the row opens on.
  const prefetch = useCallback(() => {
    loadPanelCode()
      .then(([cc]) =>
        Promise.all([
          loadCatalogue(),
          loadPath(cc.pathKey("today", asset, 0, "peak"), cc.pathUrl("today", { series: asset })),
        ]).then(([result, peak]) => {
          if (result.status !== "ready") return;
          const c = openingCaseFor(result.data, asset, linkedCase);
          if (!c) return;
          const series = cc.requestSeries(c, asset);
          const yearInto =
            (alignRef.current ??
              (peak.status === "ready" && opensOnYearInto(peak.data, c) ? "latest" : "peak")) === "latest";
          if (yearInto) {
            loadPath(
              cc.pathKey("today", asset, -365, "latest"),
              cc.pathUrl("today", { series: asset, from: -365, align: "latest" }),
            );
            loadPath(cc.pathKey(c.id, series, -365), cc.pathUrl(c.id, { series, from: -365 }));
          } else {
            loadPath(cc.pathKey(c.id, series, 0), cc.pathUrl(c.id, { series }));
          }
        }),
      )
      .catch(() => {});
  }, [asset, linkedCase]);

  // Start loading when the row comes within reach of the screen (inside the
  // page's own scroller).
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) {
          observer.disconnect();
          prefetch();
        }
      },
      { root: row.closest("main"), rootMargin: "600px 0px" },
    );
    observer.observe(row);
    return () => observer.disconnect();
  }, [prefetch]);

  // A deep link opens the row on its case and brings it into view once the
  // sections above it have their data (their heights are reserved) and the
  // panel has read its paths, so nothing in view moves after the scroll (a
  // slow panel gets 3 s). The scroll waits one painted frame: scrolling in
  // the frame that first paints the opened row would count its growth as a
  // layout shift.
  useEffect(() => {
    if (!linkedId || !engine || scrolledRef.current) return undefined;
    let outer = 0;
    let inner = 0;
    const go = () => {
      outer = window.requestAnimationFrame(() => {
        inner = window.requestAnimationFrame(() => {
          if (scrolledRef.current) return;
          scrolledRef.current = true;
          rowRef.current?.scrollIntoView({ block: "start" });
        });
      });
    };
    let timer = 0;
    if (settled) go();
    else timer = window.setTimeout(go, 3000);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [linkedId, engine, settled]);

  // A reader who scrolls, swipes or uses the keyboard before the deep link's
  // scroll runs keeps their place: the pending scroll is dropped.
  useEffect(() => {
    const page = rowRef.current?.closest("main");
    if (!linkedId || !page || scrolledRef.current) return undefined;
    const drop = () => {
      scrolledRef.current = true;
    };
    const options = { passive: true, once: true };
    page.addEventListener("wheel", drop, options);
    page.addEventListener("touchstart", drop, options);
    window.addEventListener("keydown", drop, { once: true });
    return () => {
      page.removeEventListener("wheel", drop, options);
      page.removeEventListener("touchstart", drop, options);
      window.removeEventListener("keydown", drop, { once: true });
    };
  }, [linkedId]);

  const announce = useCallback((text) => {
    setAnnouncement((previous) => ({ text, n: previous.n + 1 }));
  }, []);

  const handleSettled = useCallback(() => setSettled(true), []);

  const handleChoose = (next, changed) => {
    setChoice((previous) => {
      const draw = { ...previous.draw };
      for (const key of changed) draw[key] += 1;
      return { ...previous, a: next.a, b: next.b, draw, linked: null };
    });
  };

  // A view change, like Convergence's span: the lines do not draw in again.
  const handleAlign = (align) => {
    setChoice((previous) => (previous.align === align ? previous : { ...previous, align }));
  };

  return (
    <details
      ref={rowRef}
      data-pattern-compare=""
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group border-t border-(--sh-line-1)"
    >
      <summary
        onPointerEnter={prefetch}
        onPointerDown={prefetch}
        onFocus={prefetch}
        className={SUMMARY}
      >
        <span className={SUMMARY_LABEL}>
          <span className="max-sm:hidden">Compare today with a past decline</span>
          <span className="sm:hidden">Today vs a past decline</span>
        </span>
        <span className="ml-auto flex items-center gap-3">
          {count ? (
            <span className="text-right font-mono text-micro text-(--sh-text-3) max-sm:hidden">
              {count} cases
            </span>
          ) : null}
          <span
            className="text-base leading-none text-(--sh-text-3) transition-transform duration-(--sh-dur-micro) group-open:rotate-45 motion-reduce:transition-none"
            aria-hidden="true"
          >
            +
          </span>
        </span>
      </summary>
      {/* The panel shares the summary's 4 px inset, so the label, the
          pickers, the sentence, the toggle and the chart keep one edge. */}
      <div className="px-1 pb-5 pt-1">
        {open ? (
          <Suspense fallback={<PanelSkeleton asset={asset} />}>
            <ComparePanel
              asset={asset}
              choice={choice}
              onChoose={handleChoose}
              onAlign={handleAlign}
              onSettled={handleSettled}
              announce={announce}
            />
          </Suspense>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement.text}
          {announcement.n % 2 ? "​" : ""}
        </p>
      </div>
    </details>
  );
}

export default PatternCompare;
