const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

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
  return DATE_FORMATTER.format(new Date(timestamp));
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
    equity: isDark ? "#d8b47a" : "#8a6a3a",
    equitySoft: isDark ? "rgba(216,180,122,0.18)" : "rgba(138,106,58,0.14)",
    strength: isDark ? "#5eead4" : "#0f766e",
    strengthSoft: isDark ? "rgba(94,234,212,0.22)" : "rgba(15,118,110,0.16)",
    grid: isDark ? "rgba(255,255,255,0.075)" : "rgba(20,18,26,0.075)",
    axis: isDark ? "rgba(242,237,228,0.45)" : "rgba(20,18,26,0.45)",
    axisStrong: isDark ? "rgba(242,237,228,0.72)" : "rgba(20,18,26,0.7)",
    crimson: CRIMSON,
  };
}
