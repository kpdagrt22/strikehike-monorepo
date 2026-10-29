// Formatters, whitelists and copy for the Study of Patterns page (engine
// "patterns-v2"). Engine codes reach the surface only through the whitelists
// below: an unknown code renders nothing. Numbers use U+2212 for minus;
// changes carry one decimal, usual shares are whole percentages.
//
// This module loads with the page. The chart and its readout (AnalogFan.jsx)
// and the Evidence section load after it, so code only they use lives there.

export const MINUS = "−";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

// Box geometry shared by the instrument and its placeholder, so the chart,
// the readout and the years never shift when the chart's code arrives.
export const FAN_BOX = "relative h-[216px] min-[350px]:h-[232px] sm:h-[260px] lg:h-[300px]";
// Reserved readout heights cover the tallest selection at each width (the
// mirror on phones), so a tap or hover never moves the years below it.
export const READOUT_BOX =
  "mt-1.5 flex min-h-[8rem] flex-col gap-1 border-t border-(--sh-line-1) pt-2.5 min-[390px]:min-h-[7rem] sm:min-h-[5.625rem] lg:min-h-[4.75rem] xl:min-h-[3.5rem]";
// From 640 px the bottom padding holds the "next year included" line under
// the years (an 8 px gap and one line, measured 640–1920 px), so it never
// moves anything; the placeholder has the same padding.
export const STRIP_BOX =
  "relative mt-2.5 border-t border-(--sh-line-1) pt-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 sm:pb-6 lg:pb-[1.5625rem]";
export const STRIP_ROW = "mt-1.5 sm:mt-0 sm:flex sm:flex-wrap sm:items-center";
export const CHIP_GRID = "grid grid-cols-5 sm:flex sm:flex-wrap";
export const MIRROR_ROW =
  "mt-1.5 flex items-center gap-3 border-t border-(--sh-line-1) pt-1.5 sm:mt-0 sm:border-t-0 sm:pt-0";
export const CHIP_SLOT = "min-h-11 min-w-[3.6rem]";

// Dark values are unchanged; light values are the existing light counterparts
// from the palette (Risk Elevated, Bonds, S&P 500 and Gold pairs).
export const CATEGORY_COLORS = {
  Financial: { dark: "#fb7185", light: "#c0442f" },
  Geopolitics: { dark: "#a78bfa", light: "#5b21b6" },
  Science: { dark: "#67e8f9", light: "#0e7490" },
  "Science & Technology": { dark: "#67e8f9", light: "#0e7490" },
};
const CATEGORY_FALLBACK = { dark: "#facc15", light: "#a16207" };

export function categoryPair(category) {
  return CATEGORY_COLORS[category] ?? CATEGORY_FALLBACK;
}

const BASIS = { weekly_close: "weekly closes", monthly_average: "monthly averages" };
const CADENCE = { every_4_weeks: "every four weeks", monthly: "month by month" };
export const CADENCE_INTRO = { every_4_weeks: "Every four weeks", monthly: "Every month" };
// Verdicts under which the surface may state the absence of an edge.
// "better" and "weak" have no approved wording, so they render nothing.
export const DIRECTION_NO_EDGE = new Set(["no_edge", "worse"]);
export const FALLS_NO_EDGE = new Set(["no_edge", "worse", "not_measurable"]);
export const RANKING_NONE = new Set(["none", "unstable"]);
// Data tags for S&P setups; the S&P 500 itself needs no tag in readouts.
const SOURCE_TAGS = { sp90: "S&P 90 data", cowles: "Cowles monthly index" };
const SOURCE_LABELS = { ...SOURCE_TAGS, sp500: "S&P 500 data" };
const SP90_FROM = "1927-12-30";
const SP500_FROM = "1957-03-04";

/** "10 closest setups", "1 closest setup" (a thin library can list one). */
export function setupsLabel(k, closest = true) {
  return `${k} ${closest ? "closest " : ""}${k === 1 ? "setup" : "setups"}`;
}

export function finite(value) {
  return value != null && Number.isFinite(Number(value));
}

function parts(value) {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month, day: Number(match[3]) };
}

export function yearOf(value) {
  return parts(value)?.year ?? null;
}

/**
 * "05 Sep 2008": the engine pages' day format (regimeUtils' formatDate, kept
 * here so the page's initial JS does not load regimeUtils).
 */
export function formatDate(value) {
  const timestamp =
    typeof value === "number" ? value : value ? Date.parse(`${value}T00:00:00Z`) : Number.NaN;
  if (!Number.isFinite(timestamp)) return "—";
  const date = new Date(timestamp);
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "Jun 1985" */
export function formatMonth(value) {
  const p = parts(value);
  return p ? `${MONTHS[p.month - 1]} ${p.year}` : "—";
}

/** "+3.9%", "−42.9%", "0.0%" */
export function formatChange(value, digits = 1) {
  if (!finite(value)) return "—";
  const number = Number(value);
  const size = Math.abs(number).toFixed(digits);
  if (Number(size) === 0) return `${size}%`;
  return `${number > 0 ? "+" : MINUS}${size}%`;
}

/** A usual share: whole percent, "70%". */
export function formatShare(value) {
  if (!finite(value)) return "—";
  return `${Math.round(Number(value))}%`;
}

export function formatCount(value) {
  return finite(value) ? Number(value).toLocaleString("en-US") : "—";
}

export function basisLabel(basis) {
  return BASIS[basis] ?? null;
}

/** "52-week" or "12-month": the length of one window, for rank lines. */
export function windowLabel(engine) {
  const periods = engine?.window?.periods;
  const unit = engine?.window?.unit;
  if (!(periods > 0) || (unit !== "week" && unit !== "month")) return "12-month";
  return `${periods}-${unit}`;
}

/** The readout tag for a setup's data source (none for the S&P 500 itself). */
export function sourceTag(code) {
  return SOURCE_TAGS[code] ?? null;
}

/** The Evidence table's Data cell. */
export function sourceLabel(code) {
  return SOURCE_LABELS[code] ?? null;
}

/** The mirror carries no source code: its monthly bank is Cowles to 1927. */
export function mirrorSourceTag(windowEnd) {
  if (typeof windowEnd !== "string") return null;
  if (windowEnd < SP90_FROM) return SOURCE_TAGS.cowles;
  return windowEnd < SP500_FROM ? SOURCE_TAGS.sp90 : null;
}

/** Financial first, then Geopolitics, then Science; earliest within each. */
export function firstEvent(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const order = ["Financial", "Geopolitics", "Science", "Science & Technology"];
  const rank = (event) => {
    const index = order.indexOf(event?.category);
    return index === -1 ? order.length : index;
  };
  return [...events].sort(
    (a, b) => rank(a) - rank(b) || String(a?.date).localeCompare(String(b?.date)),
  )[0];
}

/** The engine block this page reads, checked before anything renders. */
export function isPatternEngine(engine) {
  if (!engine || engine.version !== "patterns-v2") return false;
  if (engine.status !== "ok" && engine.status !== "insufficient") return false;
  if (!Array.isArray(engine.current?.path) || !Array.isArray(engine.analogs)) return false;
  if (!(engine.window?.periods > 0)) return false;
  if (engine.status === "insufficient") return true;
  const outlook = engine.outlook;
  const twelve = outlook?.horizons?.find?.((horizon) => horizon?.months === 12);
  return Boolean(
    twelve &&
      finite(outlook.k) &&
      finite(twelve.higher) &&
      finite(twelve.base_share_up_pct) &&
      finite(outlook.usual_since_year) &&
      Array.isArray(outlook.median_path) &&
      Array.isArray(outlook.usual_paths?.q25) &&
      Array.isArray(outlook.usual_paths?.q50) &&
      Array.isArray(outlook.usual_paths?.q75),
  );
}

export function horizonOf(engine, months) {
  return engine?.outlook?.horizons?.find?.((horizon) => horizon?.months === months) ?? null;
}

export function historyYears(engine) {
  const start = Date.parse(`${String(engine?.history_start).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(engine?.as_of).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / (365.25 * DAY_MS));
}

/** The answer (H2), also announced after a lens switch. */
export function answerText(engine) {
  if (!engine) return null;
  if (engine.status === "insufficient" || !engine.outlook) {
    return "Too little history to say what usually came next.";
  }
  const twelve = horizonOf(engine, 12);
  const k = Number(engine.outlook.k);
  const n = Number(twelve?.higher);
  const usual = Math.round(Number(twelve?.base_share_up_pct));
  const since = engine.outlook.usual_since_year;
  if (![k, n, usual, since].every(Number.isFinite) || k < 1) return null;
  const tail = `higher a year later; ${usual}% of all years since ${since} were.`;
  if (n === k) return `All ${k} past setups most like today’s were ${tail}`;
  if (n === 0) return `None of the ${k} past setups most like today’s was ${tail}`;
  if (n === 1) return `1 of the ${k} past setups most like today’s was ${tail}`;
  return `${n} of the ${k} past setups most like today’s were ${tail}`;
}

export function freshSkill(engine) {
  const skill = engine?.skill;
  return skill?.available === true && skill.stale !== true ? skill : null;
}

/** Thin: under 25 years of history, or under 20 independent tested years. */
export function thinRecord(engine) {
  const years = historyYears(engine);
  const skill = freshSkill(engine);
  const independent = Number(skill?.independent_years);
  return (years != null && years < 25) || (skill != null && Number.isFinite(independent) && independent < 20);
}

/** A fresh, long record whose direction and 20% falls show no edge. */
export function noEdgeRecord(engine) {
  const skill = freshSkill(engine);
  return Boolean(
    skill &&
      !thinRecord(engine) &&
      Number(skill.independent_years) >= 20 &&
      DIRECTION_NO_EDGE.has(skill.direction?.verdict) &&
      FALLS_NO_EDGE.has(skill.falls_20?.verdict),
  );
}

/** The honesty line under the answer, or null when no approved line applies. */
export function skillLine(engine, assetLabel) {
  if (!engine) return null;
  if (thinRecord(engine)) {
    const years = historyYears(engine);
    return years != null && assetLabel
      ? `Only ${years} years of ${assetLabel} history: too short to test this comparison.`
      : null;
  }
  if (!noEdgeRecord(engine)) return null;
  const skill = engine.skill;
  const cadence = CADENCE[skill.cadence];
  const since = yearOf(skill.period?.[0]);
  if (!cadence || !since) return null;
  return `Tested ${cadence} since ${since}, using only the history available at each date, this comparison has not beaten the usual rate.`;
}

export function mirrorExact(engine) {
  const mirror = engine?.mirror;
  return mirror?.available === true && mirror.exact ? mirror.exact : null;
}

/** "closer than 83%": the floor, capped at 99% (the payload rounds to one
 * decimal, so 99.96 arrives as 100), so the figure is never overstated. */
export function closerThan(value) {
  return finite(value) ? `${Math.min(99, Math.floor(Number(value)))}%` : "—";
}

export function mirrorNoInformation(engine) {
  const evidence = engine?.mirror?.evidence;
  return evidence?.verdict === "no_information" && Number(evidence.months_tested) > 0 ? evidence : null;
}

export function mirrorLine(engine) {
  const exact = mirrorExact(engine);
  if (!exact || !finite(exact.closer_than_pct)) return null;
  const head = `The 120-year mirror is closer than ${closerThan(exact.closer_than_pct)} of past windows today`;
  const evidence = mirrorNoInformation(engine);
  return evidence
    ? `${head}; in ${formatCount(evidence.months_tested)} monthly tests it matched no better than chance.`
    : `${head}.`;
}
