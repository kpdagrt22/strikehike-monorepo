/**
 * Pure helpers for comparing two market declines from the case catalogue
 * (GET /api/v1/regime/cases) and their aligned paths
 * (GET /api/v1/regime/cases/{id}/path). Shared by /convergence and the Study
 * of Patterns compare panel. No React, no fetch, no DOM: every function is
 * deterministic and every number it prints comes from the payload.
 *
 * Copy rules baked in here: descriptive comparatives only (fell deeper, about
 * as far, reached its low faster, about as long, was back at its peak sooner,
 * had not been, rose, fell), the Unicode minus, one decimal for % and years,
 * whole months and days, month-precise cases shown as "Sep 1906".
 *
 * Exports
 *   Formatting
 *     MINUS                               "−"
 *     formatPct(value, digits = 1)        "−56.8%", "+20.0%", "0.0%"
 *     formatAbsPct(value, digits = 1)     "56.8%" (magnitude, for "fell 56.8%")
 *     formatSignedValue(value, digits=1)  "+12.5", "−24.0" (Core Index points)
 *     formatCaseDate(iso, precision)      "9 Mar 2009" | "Mar 2009" (precision "month")
 *     formatMonth(isoOrMonth)             "Dec 2007" (from "2007-12" or "2007-12-01")
 *     formatDuration(days)                "33 days" | "17 months" | "5.5 years"
 *     durationPair(first, second, { soFar: [bool, bool] })
 *                                         "33 vs 63 days" | "6 vs 23 months" | "33 days vs 17 months"
 *     caseYears(c)                        "2007–09", "1887–96", "2026"
 *     caseSubline(c)                      "2007–09 · −56.8%" (open: "2026 · −15.6% so far")
 *     caseMeta(c)                         "2007 · −56.8%"   (open: "2026 · −15.6% so far")
 *   Dates and paths
 *     isoToMs(iso), addDays(iso, n), daysBetween(fromIso, toIso)
 *     indexAt(d, day)                     index of the sample at or before `day` (binary search) or -1
 *     valueAt(d, values, day)             that sample's value, or null
 *     pathKey(id, series, from, align)    "regime-case-path:{id}:{series}:{from}:{align}" (the proxy's key)
 *     pathUrl(id, { series, from, align }) "/api/v1/regime/cases/{id}/path?..." (canonical query)
 *     requestSeries(caseObj, seriesKey)   "own" when the case is measured on that series, else the key
 *   Comparison
 *     isOpen(c), isUnobservable(c)
 *     spanEnd(a, b, span, asOf?)          x-axis end in days: "decline" | "recovery" (UX §4.1 rules)
 *     lineStop(c, span)                   last day drawn for a case in the Recovery span, or null
 *     chooseLaneMeasure(a, b, coverage)   { key: "ci"|"ms"|null, label, notes: {a, b}, partial, collapsed }
 *     coreIndexBucketOf(value)            v2 band for a Core Index value
 *     macroStateOf(value)                 "favorable" | "neutral" | "disruptive" (40 / 60 thresholds)
 *     describePair(a, b, { series, paths, coverage, status })
 *                                         { tokens: [{kind: "subject"|"text"|"num", side?, text}], text }
 *                                         status {a, b}: "ready" | "loading" | "error" per path (another
 *                                         series only): a loading side gets a same-shape placeholder
 *                                         (for sizing a hidden copy), an errored side is left out.
 *     footingLine(a, b)                   "A on Bitcoin, B on the S&P 500." or null
 *     seriesName(c)                       "the S&P 500", "Bitcoin", "the Cowles US stock index (monthly average)"
 *   Series control
 *     SERIES_OPTIONS                      [{ key, label, sentence }] in pill order (own first)
 *     seriesLabel(key, form = "pill")     "US stocks"; form "sentence": "gold", "the Nifty 50"; form "noun": "bond"
 *     seriesAvailability(a, b, key, coverage)
 *                                         { ok, reason } with reasons like "No Bitcoin data before Aug 2010 (Dot-com)"
 *     caseSeriesNote(c, key, coverage)    "no Bitcoin data before Aug 2010" for a case without `key`, else null
 *   Recessions and events
 *     recessionsFor(c, recessionsById)    the case's NBER recession objects, in order
 *     recessionSpan(r)                    "Dec 2007 – Jun 2009"
 *     recessionContext(r)                 "During the Great Recession (NBER Dec 2007 – Jun 2009)"
 *   Search (CasePicker)
 *     ERAS                                [{ key, label, test(year) }]
 *     normaliseQuery(text)                lowercase, no diacritics; dashes, brackets, commas as spaces
 *     queryTokens(text)                   normalised tokens
 *     buildCaseIndex(cases, kinds, recessions)   Map id -> search entry
 *     matchCase(entry, tokens)            null | { score, total, event: {name, date} | null, recession }
 *     highlightSegments(text, tokens)     [{ text, mark }] (word-prefix matches in the name)
 */

export const MINUS = "−";
const EN_DASH = "–";
const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------- formatting

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatPct(value, digits = 1) {
  const number = finite(value);
  if (number == null) return "—";
  const abs = Math.abs(number).toFixed(digits);
  if (Number(abs) === 0) return `${(0).toFixed(digits)}%`;
  return `${number < 0 ? MINUS : "+"}${abs}%`;
}

export function formatAbsPct(value, digits = 1) {
  const number = finite(value);
  if (number == null) return "—";
  return `${Math.abs(number).toFixed(digits)}%`;
}

export function formatSignedValue(value, digits = 1) {
  const number = finite(value);
  if (number == null) return "—";
  const abs = Math.abs(number).toFixed(digits);
  if (Number(abs) === 0) return (0).toFixed(digits);
  return `${number < 0 ? MINUS : "+"}${abs}`;
}

export function isoToMs(iso) {
  if (!iso || typeof iso !== "string") return null;
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function addDays(iso, days) {
  const ms = isoToMs(iso);
  if (ms == null || !Number.isFinite(days)) return null;
  return new Date(ms + Math.round(days) * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  const from = isoToMs(fromIso);
  const to = isoToMs(toIso);
  if (from == null || to == null) return null;
  return Math.round((to - from) / DAY_MS);
}

export function formatCaseDate(iso, precision = "day") {
  const ms = isoToMs(iso);
  if (ms == null) return "—";
  const date = new Date(ms);
  const monthYear = `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return precision === "month" ? monthYear : `${date.getUTCDate()} ${monthYear}`;
}

export function formatMonth(value) {
  if (!value || typeof value !== "string") return "—";
  const [year, month] = value.split("-");
  const index = Number(month) - 1;
  if (!year || !(index >= 0 && index < 12)) return "—";
  return `${MONTHS[index]} ${year}`;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatDuration(days) {
  const number = finite(days);
  if (number == null) return "—";
  const d = Math.max(0, Math.round(number));
  if (d < 60) return plural(d, "day", "days");
  if (d < 730) return plural(Math.round(d / 30.4375), "month", "months");
  return `${(d / 365.25).toFixed(1)} years`;
}

const unitFor = (days) => (days < 120 ? "days" : days < 730 ? "months" : "years");

function inUnit(days, unit) {
  if (unit === "days") return `${Math.round(days)}`;
  if (unit === "months") return `${Math.round(days / 30.4375)}`;
  return (days / 365.25).toFixed(1);
}

/**
 * Two durations, the unit taken from the larger one. One shared unit when the
 * smaller value still reads at least 2 months or 1 year in it ("33 vs 63
 * days", "6 vs 23 months", "2.0 vs 15.1 years"); otherwise each in its own
 * unit ("33 days vs 17 months"). An open case's value carries "so far" and
 * always uses its own unit ("9 months so far vs 33 days").
 */
export function durationPair(first, second, { soFar = [false, false] } = {}) {
  const a = finite(first);
  const b = finite(second);
  if (a == null || b == null) return `${formatDuration(a)} vs ${formatDuration(b)}`;
  if (soFar[0] || soFar[1]) {
    return `${formatDuration(a)}${soFar[0] ? " so far" : ""} vs ${formatDuration(b)}${soFar[1] ? " so far" : ""}`;
  }
  const unit = unitFor(Math.max(a, b));
  const small = Math.min(a, b);
  const fits =
    unit === "days" ||
    (unit === "months" ? small / 30.4375 >= 2 : small / 365.25 >= 1);
  if (fits) return `${inUnit(a, unit)} vs ${inUnit(b, unit)} ${unit}`;
  return `${formatDuration(a)} vs ${formatDuration(b)}`;
}

/** Whether durationPair would print both values the same ("7 vs 7 months"). */
function printsSame(a, b, soFar) {
  if (soFar[0] || soFar[1]) return formatDuration(a) === formatDuration(b);
  const unit = unitFor(Math.max(a, b));
  const small = Math.min(a, b);
  const fits =
    unit === "days" ||
    (unit === "months" ? small / 30.4375 >= 2 : small / 365.25 >= 1);
  return fits ? inUnit(a, unit) === inUnit(b, unit) : formatDuration(a) === formatDuration(b);
}

/**
 * A duration pair in the sentence: durationPair, or days when both would
 * print the same in the pair's unit ("215 vs 212 days", not "7 vs 7
 * months"), so a clause never hides the difference it describes.
 */
function closeDurationPair(first, second, soFar = [false, false]) {
  const a = finite(first);
  const b = finite(second);
  if (a == null || b == null || !printsSame(a, b, soFar)) {
    return durationPair(first, second, { soFar });
  }
  const dA = Math.max(0, Math.round(a));
  const dB = Math.max(0, Math.round(b));
  if (soFar[0] || soFar[1]) {
    return `${plural(dA, "day", "days")}${soFar[0] ? " so far" : ""} vs ${plural(dB, "day", "days")}${soFar[1] ? " so far" : ""}`;
  }
  return `${dA} vs ${dB} days`;
}

export function isOpen(c) {
  return c?.recovery_status === "not_recovered" || Boolean(c?.flags?.open);
}

export function isUnobservable(c) {
  return c?.recovery_status === "unobservable" || Boolean(c?.flags?.recovery_unobservable);
}

export function caseYears(c) {
  const first = c?.peak?.slice(0, 4);
  const last = (c?.trough ?? c?.peak)?.slice(0, 4);
  if (!first) return "—";
  if (!last || last === first) return first;
  return first.slice(0, 2) === last.slice(0, 2)
    ? `${first}${EN_DASH}${last.slice(2)}`
    : `${first}${EN_DASH}${last}`;
}

function depthText(c) {
  return `${formatPct(c?.depth_pct)}${isOpen(c) ? " so far" : ""}`;
}

export function caseSubline(c) {
  return `${caseYears(c)} · ${depthText(c)}`;
}

export function caseMeta(c) {
  return `${c?.peak?.slice(0, 4) ?? "—"} · ${depthText(c)}`;
}

// ---------------------------------------------------------------- paths

/** Index of the sample at or before `day` in ascending `d`, or -1. */
export function indexAt(d, day) {
  if (!Array.isArray(d) || !d.length || !Number.isFinite(day)) return -1;
  if (day < d[0]) return -1;
  let lo = 0;
  let hi = d.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (d[mid] <= day) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function valueAt(d, values, day) {
  if (!Array.isArray(values)) return null;
  const index = indexAt(d, day);
  if (index < 0) return null;
  return finite(values[index]);
}

export function pathKey(id, series = "own", from = 0, align = "peak") {
  return `regime-case-path:${id}:${series}:${from}:${align}`;
}

export function pathUrl(id, { series = "own", from = 0, align = "peak" } = {}) {
  const params = new URLSearchParams();
  if (series && series !== "own") params.set("series", series);
  if (from) params.set("from", String(from));
  if (id === "today" && align && align !== "peak") params.set("align", align);
  const query = params.toString();
  return `/api/v1/regime/cases/${encodeURIComponent(id)}/path${query ? `?${query}` : ""}`;
}

/** "own" when the case is measured on that series (one cache entry, not two). */
export function requestSeries(caseObj, seriesKey) {
  if (!seriesKey || seriesKey === "own") return "own";
  return caseObj?.series?.key === seriesKey ? "own" : seriesKey;
}

// ---------------------------------------------------------------- spans

function endDays(c, asOf) {
  if (Number.isFinite(c?.days_to_recovery)) return c.days_to_recovery;
  const last = c?.latest?.date ?? asOf;
  const days = daysBetween(c?.peak, last);
  return Number.isFinite(days) ? days : c?.days_to_trough ?? 0;
}

/**
 * Decline: max(45, ceil(1.15 × the later low)), so the fast case's position
 * when the slow one hit bottom stays visible. Recovery: ceil(1.06 × the later
 * recovery, or the data end for a case that has not recovered).
 */
export function spanEnd(a, b, span = "decline", asOf = null) {
  if (span === "recovery") {
    return Math.max(45, Math.ceil(1.06 * Math.max(endDays(a, asOf), endDays(b, asOf))));
  }
  const later = Math.max(a?.days_to_trough ?? 0, b?.days_to_trough ?? 0);
  return Math.max(45, Math.ceil(1.15 * later));
}

/**
 * Recovery span only: each line stops at its own recovery plus
 * min(60, max(14, 2% of the days)), so a fast recovery does not run on for
 * decades and flatten the other line.
 */
export function lineStop(c, span = "decline") {
  if (span !== "recovery" || !Number.isFinite(c?.days_to_recovery)) return null;
  const days = c.days_to_recovery;
  return days + Math.min(60, Math.max(14, Math.round(days * 0.02)));
}

// ---------------------------------------------------------------- the lane

export function coreIndexBucketOf(value) {
  const number = finite(value);
  if (number == null) return null;
  if (number >= 25) return "strong_bullish";
  if (number >= 0) return "calm_bullish";
  if (number > -25) return "bearish_warning";
  return "extreme_bearish";
}

/** Macro strength regime: favorable from 60, disruptive at 40 or below. */
export function macroStateOf(value) {
  const number = finite(value);
  if (number == null) return null;
  if (number >= 60) return "favorable";
  if (number <= 40) return "disruptive";
  return "neutral";
}

function hasCoreIndex(c) {
  return finite(c?.core_index?.at_peak) != null;
}

function hasMacro(c) {
  const block = c?.macro_strength;
  return Boolean(block && (block.at_peak?.value != null || block.at_trough?.value != null));
}

function macroCoverage(c) {
  const values = [c?.macro_strength?.at_peak?.coverage, c?.macro_strength?.at_trough?.coverage]
    .map(finite)
    .filter((value) => value != null);
  return values.length ? Math.min(...values) : null;
}

/**
 * The lane shows the Core Index when both cases have one at the peak,
 * otherwise macro strength when both have it, otherwise whichever exists for
 * one side (the other side gets a note), otherwise nothing.
 */
export function chooseLaneMeasure(a, b, coverage = {}) {
  const coreStart = formatMonth(coverage?.core_index_start);
  const macroStart = formatMonth(coverage?.macro_strength_start);
  const macroFull = formatMonth(coverage?.macro_strength_full_from);
  const coreNote = `no Core Index before ${coreStart}`;
  const macroNote = `no macro data before ${macroStart}`;
  const ciA = hasCoreIndex(a);
  const ciB = hasCoreIndex(b);
  if (ciA && ciB) {
    return { key: "ci", label: "Core Index", notes: { a: null, b: null }, partial: null, collapsed: null };
  }
  const msA = hasMacro(a);
  const msB = hasMacro(b);
  if (msA && msB) {
    const low = [macroCoverage(a), macroCoverage(b)].filter((value) => value != null);
    const partial = low.some((value) => value < 0.99) ? `partial inputs before ${macroFull}` : null;
    return { key: "ms", label: "Macro strength", notes: { a: null, b: null }, partial, collapsed: null };
  }
  if (ciA || ciB) {
    return {
      key: "ci",
      label: "Core Index",
      notes: { a: ciA ? null : coreNote, b: ciB ? null : coreNote },
      partial: null,
      collapsed: null,
    };
  }
  if (msA || msB) {
    return {
      key: "ms",
      label: "Macro strength",
      notes: { a: msA ? null : macroNote, b: msB ? null : macroNote },
      partial: null,
      collapsed: null,
    };
  }
  return {
    key: null,
    label: null,
    notes: { a: null, b: null },
    partial: null,
    collapsed: "Neither case has a Core Index or macro reading.",
  };
}

// ---------------------------------------------------------------- series

// label: the pill; sentence: "Through {sentence}, …"; noun: "No {noun} data …".
export const SERIES_OPTIONS = [
  { key: "own", label: "Own market", sentence: "each case's own market", noun: "own-market" },
  { key: "sp500", label: "US stocks", sentence: "US stocks", noun: "US stock" },
  { key: "gold", label: "Gold", sentence: "gold", noun: "gold" },
  { key: "bonds", label: "Bonds", sentence: "bonds", noun: "bond" },
  { key: "nifty", label: "Nifty 50", sentence: "the Nifty 50", noun: "Nifty 50" },
  { key: "bitcoin", label: "Bitcoin", sentence: "Bitcoin", noun: "Bitcoin" },
];

const SERIES_BY_KEY = Object.fromEntries(SERIES_OPTIONS.map((option) => [option.key, option]));

export function seriesLabel(key, form = "pill") {
  const option = SERIES_BY_KEY[key];
  if (!option) return key ?? "";
  if (form === "sentence") return option.sentence;
  if (form === "noun") return option.noun;
  return option.label;
}

/** "no gold data before Jan 1968", "no gold data after Sep 2026" or "no gold data". */
function seriesMissingText(c, key, coverage) {
  const noun = seriesLabel(key, "noun");
  const first = coverage?.series_first_obs?.[key];
  const last = coverage?.series_last_obs?.[key];
  if (first && c?.peak && c.peak < first) return `no ${noun} data before ${formatMonth(first)}`;
  const low = c?.trough ?? c?.peak;
  if (last && low && low > last) return `no ${noun} data after ${formatMonth(last)}`;
  return `no ${noun} data for this case`;
}

function upperFirst(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** Whether both cases carry `key` around their peaks, and why not. */
export function seriesAvailability(a, b, key, coverage = {}) {
  if (!key || key === "own") return { ok: true, reason: null };
  for (const c of [a, b]) {
    if (!c) continue;
    const available = c.series?.key === key || (c.series_available ?? []).includes(key);
    if (!available) {
      return { ok: false, reason: `${upperFirst(seriesMissingText(c, key, coverage))} (${c.short_name ?? c.name})` };
    }
  }
  return { ok: true, reason: null };
}

/** The quiet note a case without `key` carries in the picker ("no Bitcoin data before Aug 2010"). */
export function caseSeriesNote(c, key, coverage = {}) {
  if (!c || !key || key === "own" || c.id === "today") return null;
  if (c.series?.key === key || (c.series_available ?? []).includes(key)) return null;
  return seriesMissingText(c, key, coverage);
}

/** The measured series in prose: "the S&P 500", "Bitcoin", "gold (monthly average)". */
export function seriesName(c) {
  const label = c?.series?.label ?? "";
  let head = label.split(",")[0].replace(/\s*\([^)]*\)/g, "").trim();
  if (!head) return "its own market";
  if (c?.kind === "gold") head = "gold";
  const bare = /^(Bitcoin|gold)$/i.test(head);
  const named = bare ? head : `the ${head}`;
  return c?.series?.resolution === "monthly" ? `${named} (monthly average)` : named;
}

/** Shown under the sentence when the two cases are measured on different series. */
export function footingLine(a, b) {
  if (!a || !b) return null;
  const nameA = seriesName(a);
  const nameB = seriesName(b);
  if (nameA === nameB) return null;
  return `A on ${nameA}, B on ${nameB}.`;
}

// ---------------------------------------------------------------- the sentence

function subject(side, text) {
  return { kind: "subject", side, text };
}

function text(value) {
  return { kind: "text", text: value };
}

function num(value) {
  return { kind: "num", text: value };
}

function sideOf(c, a) {
  return c === a ? "a" : "b";
}

// The implied subject of an "about as" clause; like a case, a repeat of it
// is dropped ("Both fell about as far (…), took about as long …").
const BOTH = "both";

function depthClause(a, b) {
  const dA = Math.abs(a.depth_pct);
  const dB = Math.abs(b.depth_pct);
  if (Math.abs(dA - dB) < 1) {
    return { who: BOTH, parts: [text(" fell about as far ("), num(`${depthText(a)} and ${depthText(b)}`), text(")")] };
  }
  const deeper = dA > dB ? a : b;
  const other = deeper === a ? b : a;
  return {
    who: deeper,
    parts: [text(" fell deeper ("), num(`${depthText(deeper)} vs ${depthText(other)}`), text(")")],
  };
}

function speedClause(a, b) {
  const fast = a.days_to_trough <= b.days_to_trough ? a : b;
  const slow = fast === a ? b : a;
  if (slow.days_to_trough / Math.max(1, fast.days_to_trough) < 1.1) {
    const pair = closeDurationPair(a.days_to_trough, b.days_to_trough, [isOpen(a), isOpen(b)]);
    return { who: BOTH, parts: [text(" took about as long to reach the low ("), num(pair), text(")")] };
  }
  return {
    who: fast,
    parts: [
      text(" reached its low faster ("),
      num(closeDurationPair(fast.days_to_trough, slow.days_to_trough, [isOpen(fast), isOpen(slow)])),
      text(")"),
    ],
  };
}

function earlierOf(isoA, isoB) {
  if (!isoA) return isoB;
  if (!isoB) return isoA;
  return isoA < isoB ? isoA : isoB;
}

function recoveryClause(a, b) {
  const rA = Number.isFinite(a.days_to_recovery) ? a.days_to_recovery : null;
  const rB = Number.isFinite(b.days_to_recovery) ? b.days_to_recovery : null;
  if (rA != null && rB != null) {
    const soon = rA <= rB ? a : b;
    const late = soon === a ? b : a;
    if (late.days_to_recovery / Math.max(1, soon.days_to_recovery) < 1.1) {
      return {
        who: BOTH,
        parts: [
          text(" were back at their peaks after about as long ("),
          num(closeDurationPair(rA, rB)),
          text(")"),
        ],
      };
    }
    return {
      who: soon,
      parts: [
        text(" was back at its peak sooner ("),
        num(closeDurationPair(soon.days_to_recovery, late.days_to_recovery)),
        text(")"),
      ],
    };
  }
  if (rA != null || rB != null) {
    const done = rA != null ? a : b;
    const other = done === a ? b : a;
    const tail = isUnobservable(other)
      ? [text("; "), subject(sideOf(other, a), other.short_name), text("’s return to its peak is outside the data")]
      : [
          text("; "),
          subject(sideOf(other, a), other.short_name),
          text(" had not been by "),
          num(formatCaseDate(other.latest?.date, other.series?.precision)),
        ];
    return {
      who: done,
      parts: [text(" was back at its peak after "), num(formatDuration(done.days_to_recovery)), ...tail],
    };
  }
  if (isOpen(a) && isOpen(b)) {
    const date = earlierOf(a.latest?.date, b.latest?.date);
    return { who: null, parts: [text("neither was back at its peak by "), num(formatCaseDate(date))] };
  }
  return { who: null, parts: [text("neither return to the peak is inside the data")] };
}

function joinClauses(clauses, a) {
  const tokens = [];
  clauses.forEach((clause, index) => {
    if (index === 1) tokens.push(text(", "));
    if (index === 2) tokens.push(text(" and "));
    const repeated = index > 0 && clause.who != null && clauses[index - 1].who === clause.who;
    if (clause.who === BOTH) {
      if (!repeated) tokens.push(text(BOTH));
    } else if (clause.who && !repeated) {
      tokens.push(subject(sideOf(clause.who, a), clause.who.short_name));
    }
    const parts = [...clause.parts];
    if (repeated && parts[0]?.kind === "text") {
      parts[0] = text(parts[0].text.replace(/^ /, ""));
    }
    tokens.push(...parts);
  });
  tokens.push(text("."));
  return tokens;
}

function capitalise(tokens) {
  const first = tokens[0];
  if (!first || first.kind !== "text" || !first.text) return tokens;
  return [text(first.text.charAt(0).toUpperCase() + first.text.slice(1)), ...tokens.slice(1)];
}

function mergeText(tokens) {
  const out = [];
  for (const token of tokens) {
    const last = out[out.length - 1];
    if (token.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = text(last.text + token.text);
    } else {
      out.push(token);
    }
  }
  return out.filter((token) => token.text !== "");
}

// The width of a typical value: it only sizes a hidden copy of the sentence
// while a path loads, and is never shown.
const PLACEHOLDER_PCT = "00.0%";

function throughPart(c, a, path, key, coverage, state) {
  // A failed request says nothing about the data: leave the side out (the
  // chart readout offers Retry).
  if (state === "error") return null;
  if (state === "loading") {
    return [subject(sideOf(c, a), c.short_name), text(" fell "), num(PLACEHOLDER_PCT)];
  }
  const value = path ? valueAt(path.d, path.v, c.days_to_trough) : null;
  if (value == null) {
    return [subject(sideOf(c, a), c.short_name), text(`: ${seriesMissingText(c, key, coverage)}`)];
  }
  return [subject(sideOf(c, a), c.short_name), text(value >= 0 ? " rose " : " fell "), num(formatAbsPct(value))];
}

/**
 * The one reading sentence. With the own series: depth, speed and recovery,
 * dropping a subject that repeats the previous clause's. With another series:
 * the change on that series from each peak to each case's own low (the
 * sample at or before `days_to_trough`). `paths` = { a, b } path payloads,
 * needed only for another series; `status` = { a, b } ("ready" | "loading" |
 * "error") marks a side still loading (placeholder) or failed (left out).
 */
export function describePair(a, b, { series = "own", paths = {}, coverage = {}, status = {} } = {}) {
  if (!a || !b) return { tokens: [], text: "" };
  let tokens;
  if (series && series !== "own") {
    const parts = [
      throughPart(a, a, paths.a, series, coverage, status.a),
      throughPart(b, a, paths.b, series, coverage, status.b),
    ].filter(Boolean);
    tokens = parts.length
      ? [
          text(`Through ${seriesLabel(series, "sentence")}, from each peak to each low: `),
          ...parts.flatMap((part, index) => (index ? [text(" and "), ...part] : part)),
          text("."),
        ]
      : [];
  } else {
    tokens = capitalise(joinClauses([depthClause(a, b), speedClause(a, b), recoveryClause(a, b)], a));
  }
  tokens = mergeText(tokens);
  return { tokens, text: tokens.map((token) => token.text).join("") };
}

// ---------------------------------------------------------------- recessions

export function recessionsFor(c, recessionsById) {
  if (!c || !recessionsById) return [];
  return (c.recessions ?? []).map((id) => recessionsById.get?.(id) ?? recessionsById[id]).filter(Boolean);
}

export function recessionSpan(r) {
  return `${formatMonth(r?.start_month)} ${EN_DASH} ${formatMonth(r?.end_month)}`;
}

export function recessionContext(r) {
  if (!r) return null;
  return `During the ${r.name} (NBER ${recessionSpan(r)})`;
}

// ---------------------------------------------------------------- search

export const ERAS = [
  { key: "all", label: "All eras", test: () => true },
  { key: "pre1946", label: "Before 1946", test: (year) => year < 1946 },
  { key: "1946", label: `1946${EN_DASH}1999`, test: (year) => year >= 1946 && year < 2000 },
  { key: "2000", label: "Since 2000", test: (year) => year >= 2000 },
];

// One output character per input character, so match positions map back to
// the displayed name.
function normaliseChar(char) {
  if (/[-‐-―−]/.test(char)) return " ";
  // Brackets, commas, middots and double quotes are separators too, so a
  // name typed in full ("COVID-19 crash (Nifty 50)") still matches.
  if (/[(),·"“”]/.test(char)) return " ";
  const plain = char.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return plain.length === 1 ? plain : plain.charAt(0) || " ";
}

export function normaliseQuery(value) {
  return Array.from(String(value ?? ""), normaliseChar).join("");
}

export function queryTokens(value) {
  return normaliseQuery(value).split(/\s+/).filter(Boolean);
}

function words(value) {
  return normaliseQuery(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function decadeOf(year) {
  return `${Math.floor(Number(year) / 10) * 10}s`;
}

/**
 * A field's words joined from each word on, without separators, so a token
 * typed without a hyphen or space still finds it ("dotcom" → "Dot-com bust").
 */
function joinedRuns(list) {
  return list.slice(0, -1).map((_, index) => list.slice(index).join(""));
}

/** The initials of a field's words that start with a letter ("svbc" for "Silicon Valley Bank collapses"). */
function initialsOf(list) {
  return list.filter((word) => /^[a-z]/.test(word)).map((word) => word[0]).join("");
}

function searchField(value) {
  const list = words(value);
  return { words: list, runs: joinedRuns(list), initials: initialsOf(list) };
}

/** Map id -> normalised fields for matchCase. */
export function buildCaseIndex(cases = [], kinds = [], recessions = []) {
  const kindLabel = Object.fromEntries(kinds.map((kind) => [kind.key, kind.label]));
  const recessionById = new Map(recessions.map((r) => [r.id, r]));
  const index = new Map();
  for (const c of cases) {
    const peakYear = c.peak?.slice(0, 4);
    const troughYear = (c.trough ?? c.peak)?.slice(0, 4);
    const caseRecessions = (c.recessions ?? []).map((id) => recessionById.get(id)).filter(Boolean);
    const name = searchField(c.name);
    const short = searchField(c.short_name);
    index.set(c.id, {
      id: c.id,
      name: normaliseQuery(c.name),
      nameWords: name.words,
      shortWords: short.words,
      nameRuns: [...name.runs, ...short.runs],
      nameInitials: [name.initials, short.initials],
      aka: (c.aka ?? []).map((alias) => ({ text: normaliseQuery(alias), ...searchField(alias) })),
      kindWords: words(kindLabel[c.kind] ?? c.kind),
      regionWords: words(c.region),
      years: [peakYear, troughYear].filter(Boolean),
      decades: [...new Set([peakYear, troughYear].filter(Boolean).map(decadeOf))],
      recessions: caseRecessions.map((r) => ({ recession: r, ...searchField(r.name) })),
      events: (c.events ?? []).map((event) => ({ event, ...searchField(event.name) })),
    });
  }
  return index;
}

const prefixed = (list, token) => list.some((word) => word.startsWith(token));

// Joined runs and initials only for tokens of 3+ characters: shorter ones
// would match almost anything.
const LOOSE_MIN = 3;

function fieldMatches(field, token) {
  if (prefixed(field.words, token)) return true;
  if (token.length < LOOSE_MIN) return false;
  return prefixed(field.runs, token) || field.initials.startsWith(token);
}

function tokenTier(entry, token) {
  if (entry.name.startsWith(token)) return { tier: 0 };
  if (prefixed(entry.nameWords, token) || prefixed(entry.shortWords, token)) return { tier: 1 };
  if (
    token.length >= LOOSE_MIN &&
    (prefixed(entry.nameRuns, token) || prefixed(entry.nameInitials, token))
  ) {
    return { tier: 1 };
  }
  if (entry.aka.some((alias) => alias.text.startsWith(token) || fieldMatches(alias, token))) return { tier: 2 };
  const recession = entry.recessions.find((item) => fieldMatches(item, token));
  if (recession) return { tier: 3, recession: recession.recession };
  // An exact peak or trough year ranks above a decade ("nifty 2020" puts the
  // 2020 crash before the 2021–22 decline).
  if (
    prefixed(entry.years, token) ||
    prefixed(entry.kindWords, token) ||
    prefixed(entry.regionWords, token)
  ) {
    return { tier: 4 };
  }
  if (prefixed(entry.decades, token)) return { tier: 4.5 };
  const event = entry.events.find((item) => fieldMatches(item, token));
  if (event) return { tier: 5, event: event.event };
  return null;
}

/**
 * Every token must match a field. Lower scores rank first: name prefix (0),
 * word prefix in the name, or the name without separators or its initials
 * (1), alias (2), recession (3), year, market or region (4), decade (4.5),
 * event (5). `event` is set when a token matched only an event.
 */
export function matchCase(entry, tokens) {
  if (!entry) return null;
  if (!tokens?.length) return { score: 0, total: 0, event: null, recession: null };
  let score = 0;
  let total = 0;
  let event = null;
  let recession = null;
  for (const token of tokens) {
    const hit = tokenTier(entry, token);
    if (!hit) return null;
    score = Math.max(score, hit.tier);
    total += hit.tier;
    if (hit.event && !event) event = hit.event;
    if (hit.recession && !recession) recession = hit.recession;
  }
  return { score, total, event, recession };
}

/**
 * Name segments with the word-prefix matches of `tokens` marked; a token
 * that only matches across separators ("dotcom" in "Dot-com") marks the
 * whole run, separators included.
 */
export function highlightSegments(value, tokens) {
  const raw = String(value ?? "");
  if (!tokens?.length || !raw) return [{ text: raw, mark: false }];
  const norm = normaliseQuery(raw);
  const marks = new Array(raw.length).fill(false);
  const isWordChar = (char) => /[a-z0-9]/.test(char ?? "");
  // The name's letters and digits only, with their positions in `raw`.
  const positions = [];
  for (let i = 0; i < norm.length; i += 1) if (isWordChar(norm[i])) positions.push(i);
  const letters = positions.map((i) => norm[i]).join("");
  for (const token of tokens) {
    let found = false;
    let from = 0;
    while (from <= norm.length - token.length) {
      const at = norm.indexOf(token, from);
      if (at < 0) break;
      if (at === 0 || !isWordChar(norm[at - 1])) {
        for (let i = at; i < at + token.length; i += 1) marks[i] = true;
        found = true;
        break;
      }
      from = at + 1;
    }
    if (found || token.length < LOOSE_MIN || !/^[a-z0-9]+$/.test(token)) continue;
    for (let k = 0; k + token.length <= letters.length; k += 1) {
      const start = positions[k];
      if (start > 0 && isWordChar(norm[start - 1])) continue;
      if (!letters.startsWith(token, k)) continue;
      const end = positions[k + token.length - 1];
      for (let i = start; i <= end; i += 1) marks[i] = true;
      break;
    }
  }
  const segments = [];
  for (let i = 0; i < raw.length; i += 1) {
    const last = segments[segments.length - 1];
    if (last && last.mark === marks[i]) last.text += raw[i];
    else segments.push({ text: raw[i], mark: marks[i] });
  }
  return segments;
}
