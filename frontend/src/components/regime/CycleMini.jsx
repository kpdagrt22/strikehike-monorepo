"use client";

import {
  DRAWDOWN_THRESHOLD,
  QUADRANTS,
  VOL_THRESHOLD,
  cycleQuadrant,
} from "@/components/regime/cycleMap";

// The cycle map in small, for the chart's hover card: the four zones, the
// week's zone filled a little stronger, the prior 90 days as a trail and the
// week as a dot, with the zone named underneath. It answers "where is the
// market in its cycle on this date" where the reader is already looking, so
// scrubbing the chart shows it move (the full map sits below the chart).
// One fixed size whatever the week, so the card never changes height while
// scrubbing.
const W = 212;
const H = 64;
const INSET = 6;

const ZONES = [
  ["calm_bullish", 0, 0],
  ["volatile_bullish", 1, 0],
  ["calm_bearish", 0, 1],
  ["volatile_bearish", 1, 1],
];

export function CycleMini({ trail = [], assetLabel = "", isDark = true, ringColor }) {
  const last = trail.at(-1) ?? null;
  const zone = last ? cycleQuadrant(last.vol, last.drawdown) : null;
  const meta = zone ? QUADRANTS[zone] : null;
  // Deep falls stretch the scale (as on the full map), so a 1932 trail stays
  // inside the box.
  const deepest = Math.min(-10, ...trail.map((item) => item.drawdown));
  const yMin = Math.min(-40, deepest * 1.15);
  // Points sit a few pixels inside the box, so a week at the 100th
  // percentile or the deepest fall is never cut by the edge.
  const x = (vol) => INSET + (Math.max(0, Math.min(100, vol)) / 100) * (W - 2 * INSET);
  const y = (drawdown) =>
    INSET + (Math.max(yMin, Math.min(0, drawdown)) / yMin) * (H - 2 * INSET);
  const splitX = x(VOL_THRESHOLD);
  const splitY = y(DRAWDOWN_THRESHOLD);
  const box = {
    0: [1, splitX],
    1: [splitX, W - 1],
  };
  const band = {
    0: [1, splitY],
    1: [splitY, H - 1],
  };
  const zoneColor = (key) => (isDark ? QUADRANTS[key].fillDark : QUADRANTS[key].fill);
  const ink = isDark ? "rgba(242, 237, 228, 0.55)" : "rgba(20, 18, 26, 0.5)";
  const rule = isDark ? "rgba(242, 237, 228, 0.14)" : "rgba(20, 18, 26, 0.14)";
  const points = trail.map((item) => `${x(item.vol).toFixed(1)},${y(item.drawdown).toFixed(1)}`);

  return (
    <>
      <div className="mt-2 hidden border-t border-black/[0.08] pt-2 dark:border-white/10 sm:block">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
            Cycle · 90 days
          </span>
          <span className="truncate text-micro text-black/60 dark:text-white/60">
            {assetLabel}
          </span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-1.5 block h-16 w-full overflow-visible"
          aria-hidden="true"
        >
          {ZONES.map(([key, col, row]) => (
            <rect
              key={key}
              x={box[col][0]}
              y={band[row][0]}
              width={box[col][1] - box[col][0]}
              height={band[row][1] - band[row][0]}
              rx="2"
              fill={zoneColor(key)}
              fillOpacity={key === zone ? 0.24 : 0.07}
            />
          ))}
          <line x1={splitX} x2={splitX} y1="1" y2={H - 1} stroke={rule} strokeDasharray="2 3" />
          <line x1="1" x2={W - 1} y1={splitY} y2={splitY} stroke={rule} strokeDasharray="2 3" />
          {points.length > 1 ? (
            <polyline
              points={points.join(" ")}
              fill="none"
              stroke={ink}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {points.length > 1 ? (
            <circle cx={x(trail[0].vol)} cy={y(trail[0].drawdown)} r="1.6" fill={ink} />
          ) : null}
          {last ? (
            <circle
              cx={x(last.vol)}
              cy={y(last.drawdown)}
              r="3.6"
              fill={zoneColor(zone)}
              stroke={ringColor}
              strokeWidth="1.5"
            />
          ) : null}
        </svg>
        <p className="mt-1.5 flex items-center gap-1.5 text-micro font-medium text-black/80 dark:text-white/85">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={meta ? { backgroundColor: zoneColor(zone) } : undefined}
          />
          <span className="truncate">{meta ? meta.label : "No reading this week"}</span>
        </p>
        <p className="mt-0.5 truncate pl-3.5 text-micro text-black/60 dark:text-white/60">
          {meta ? meta.detail : `needs a year of ${assetLabel} prices`}
        </p>
      </div>
      {/* Phones: the zone in one line, so the card stays clear of the line
          being read; the full map is just below the chart. */}
      <p className="mt-1 flex items-center gap-1.5 truncate text-micro text-black/60 dark:text-white/60 sm:hidden">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-[2px]"
          style={meta ? { backgroundColor: zoneColor(zone) } : undefined}
        />
        <span className="truncate">
          Cycle: {meta ? meta.label : "no reading this week"}
        </span>
      </p>
    </>
  );
}

// Exposed for the slider's spoken text.
export function cycleZoneLabel(trail) {
  const last = trail.at(-1);
  const zone = last ? cycleQuadrant(last.vol, last.drawdown) : null;
  return zone ? QUADRANTS[zone].label : null;
}
