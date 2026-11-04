import { addDaysIso } from "@/components/regime/regimeUtils";

// The cycle map's rules, shared by the full map under the chart (PhasePlane)
// and the small one in the chart's hover card: a week sits in one of four
// zones by its one-year volatility percentile (calm below 50) and its one-year
// drawdown (deep from -10%), and its trail is the readings of the prior 90 days.
export const VOL_THRESHOLD = 50;
export const DRAWDOWN_THRESHOLD = -10;
export const TRACE_DAYS = 90;

export const QUADRANTS = {
  calm_bullish: {
    label: "Complacency",
    detail: "low volatility · shallow",
    fill: "#b45309",
    fillDark: "#fbbf24",
  },
  volatile_bullish: {
    label: "Euphoria",
    detail: "high volatility · shallow",
    fill: "#c0442f",
    fillDark: "#fb7185",
  },
  calm_bearish: {
    label: "Despair",
    detail: "low volatility · deep",
    fill: "#0f766e",
    fillDark: "#5eead4",
  },
  volatile_bearish: {
    label: "Panic",
    detail: "high volatility · deep",
    fill: "#047857",
    fillDark: "#34d399",
  },
};

// A row's reading for one asset: { vol, drawdown }, or null where either is
// missing (the asset's first year of prices, or before its series starts).
export function cycleReading(item, asset) {
  const vol = item?.[asset.percentileField];
  const drawdown = item?.[asset.drawdownField];
  if (vol == null || drawdown == null) return null;
  const reading = { vol: Number(vol), drawdown: Number(drawdown) };
  return Number.isFinite(reading.vol) && Number.isFinite(reading.drawdown)
    ? reading
    : null;
}

export function cycleQuadrant(vol, drawdown) {
  if (!Number.isFinite(vol) || !Number.isFinite(drawdown)) return null;
  if (vol >= VOL_THRESHOLD) {
    return drawdown <= DRAWDOWN_THRESHOLD ? "volatile_bearish" : "volatile_bullish";
  }
  return drawdown <= DRAWDOWN_THRESHOLD ? "calm_bearish" : "calm_bullish";
}

// The weekly trail up to timeline[index]: every week within the prior 90
// days that has a reading, oldest first, the week itself last.
export function weeklyTrail(timeline, index, asset, days = TRACE_DAYS) {
  const end = timeline?.[index];
  if (!end?.date) return [];
  const from = addDaysIso(end.date, -days);
  const trail = [];
  for (let at = index; at >= 0 && timeline[at].date >= from; at -= 1) {
    const reading = cycleReading(timeline[at], asset);
    if (reading) trail.push({ date: timeline[at].date, ...reading });
  }
  return trail.reverse();
}
