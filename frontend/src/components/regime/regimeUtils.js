// Fixed three-letter months ("Sep", never "Sept"), so every date is the same
// width and the HUD does not shift while scrubbing.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const CRIMSON = "#ef4444";

export function parseIsoDay(value) {
  if (!value) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function addMonthsIso(value, months) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const daysInMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, daysInMonth));
  return date.toISOString().slice(0, 10);
}

export function addDaysIso(value, days) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function formatDate(value) {
  const timestamp =
    typeof value === "number" ? value : parseIsoDay(value);
  if (timestamp == null || !Number.isFinite(timestamp)) return "—";
  const d = new Date(timestamp);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatNumber(value, digits = 0) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(digits)}%`;
}

export function formatScore(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(1);
}

export function formatSigned(value, digits = 1) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const formatted = number.toFixed(digits);
  return number >= 0 ? `+${formatted}` : formatted;
}

export const CORE_INDEX_BUCKETS = {
  strong_bullish: {
    label: "Risk Elevated",
    description: "+25 to +50",
    action: "Trim risk",
    allocation:
      "Risk Elevated. Trim Equities. 70% Defensive (Gold/Bonds) / 30% Equity.",
    dark: "#fb7185",
    light: "#c0442f",
    darkSoft: "rgba(251, 113, 133, 0.16)",
    lightSoft: "rgba(192, 68, 47, 0.12)",
  },
  calm_bullish: {
    label: "Balanced Growth",
    description: "0 to +24",
    action: "Stay balanced",
    allocation: "Balanced Growth. 60% Equity / 40% Defensive.",
    dark: "#facc15",
    light: "#a16207",
    darkSoft: "rgba(250, 204, 21, 0.16)",
    lightSoft: "rgba(161, 98, 7, 0.12)",
  },
  bearish_warning: {
    label: "Capital Preservation",
    description: "-1 to -24",
    action: "Wait for the bottom",
    allocation: "Capital Preservation. Wait for bottom.",
    dark: "#fb923c",
    light: "#b45309",
    darkSoft: "rgba(251, 146, 60, 0.16)",
    lightSoft: "rgba(180, 83, 9, 0.12)",
  },
  extreme_bearish: {
    label: "Maximum Fear",
    description: "-25 to -50",
    action: "Accumulate",
    allocation:
      "Maximum Fear. Aggressive Accumulation. 90% Equity / 10% Defensive.",
    dark: "#34d399",
    light: "#047857",
    darkSoft: "rgba(52, 211, 153, 0.16)",
    lightSoft: "rgba(4, 120, 87, 0.12)",
  },
};

export function coreIndexMeta(bucket) {
  return CORE_INDEX_BUCKETS[bucket] ?? null;
}

export function coreIndexLabel(bucket) {
  return CORE_INDEX_BUCKETS[bucket]?.label ?? "No score";
}

export function coreIndexTone(bucket, isDark) {
  const meta = CORE_INDEX_BUCKETS[bucket];
  if (!meta) {
    return {
      label: "No score",
      action: "Hold",
      allocation:
        "No contrarian allocation while the Core Index is unavailable.",
      color: isDark ? "rgba(242,237,228,0.6)" : "rgba(20,18,26,0.6)",
      soft: isDark
        ? "rgba(242,237,228,0.06)"
        : "rgba(20,18,26,0.05)",
    };
  }
  return {
    label: meta.label,
    description: meta.description,
    action: meta.action,
    allocation: meta.allocation,
    color: isDark ? meta.dark : meta.light,
    soft: isDark ? meta.darkSoft : meta.lightSoft,
  };
}

export function formatCompact(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}m`;
  if (number >= 1_000) return `${Math.round(number / 1_000)}k`;
  return `${Math.round(number)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function buildSegments(points, valueOf, xOf, yOf) {
  const segments = [];
  let current = [];

  for (const point of points) {
    const value = valueOf(point);
    if (value == null || !Number.isFinite(value)) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push([xOf(point), yOf(value)]);
  }

  if (current.length) segments.push(current);
  return segments;
}

export function pathFromSegment(segment) {
  if (!segment.length) return "";
  return segment
    .map(([x, y], index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function areaFromSegment(segment, baseline) {
  if (segment.length < 2) return "";
  const firstX = segment[0][0];
  const lastX = segment[segment.length - 1][0];
  const line = pathFromSegment(segment).replace(/^M/, "L");
  return `M${firstX.toFixed(2)},${baseline.toFixed(2)} ${line} L${lastX.toFixed(2)},${baseline.toFixed(2)} Z`;
}

export function decadeTicks(startMs, endMs, step = 25) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  const startYear = new Date(startMs).getUTCFullYear();
  const endYear = new Date(endMs).getUTCFullYear();
  const first = Math.ceil(startYear / step) * step;
  const ticks = [];

  for (let year = first; year <= endYear; year += step) {
    const ms = Date.UTC(year, 0, 1);
    if (ms >= startMs && ms <= endMs) ticks.push({ year, ms });
  }

  return ticks;
}

export function getChartTone(isDark) {
  return {
    equity: isDark ? "#67e8f9" : "#0e7490",
    equitySoft: isDark ? "rgba(103,232,249,0.20)" : "rgba(14,116,144,0.14)",
    strength: isDark ? "#5eead4" : "#0f766e",
    strengthSoft: isDark ? "rgba(94,234,212,0.22)" : "rgba(15,118,110,0.16)",
    grid: isDark ? "rgba(255,255,255,0.075)" : "rgba(20,18,26,0.075)",
    axis: isDark ? "rgba(242,237,228,0.45)" : "rgba(20,18,26,0.45)",
    // Readable chart text (axis labels, tick values): the 0.6 text floor.
    axisText: isDark ? "rgba(242,237,228,0.6)" : "rgba(20,18,26,0.6)",
    axisStrong: isDark ? "rgba(242,237,228,0.72)" : "rgba(20,18,26,0.7)",
    crimson: CRIMSON,
  };
}
