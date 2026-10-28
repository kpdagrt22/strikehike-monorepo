"use client";

import {
  coreIndexTone,
  formatDate,
  formatNumber,
  formatSigned,
  padReadout,
} from "@/components/regime/regimeUtils";
import {
  ASSET_TARGETS,
  assetChartColor,
} from "@/components/regime/assetTargets";

// The card's place from sm up (sm:left-7, sm:w-[244px]).
const CARD_LEFT = 28;
const CARD_WIDTH = 244;
// A signed score with one decimal is at most five characters ("+22.4").
const SCORE_CHARS = 5;

function LegendRow({ label, value, color }) {
  return (
    <>
      <span className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
        {label}
      </span>
      <span
        className="text-right font-mono text-micro font-semibold tracking-[-0.02em] text-[#14121a] tabular-nums dark:text-[#f2ede4]"
        style={color ? { color } : undefined}
      >
        {value}
      </span>
    </>
  );
}

export function ChartCrosshairLegend({
  point,
  asset = ASSET_TARGETS.sp500,
  isDark = true,
  active = false,
  side = "left",
  room = 0,
  rightInset = 0,
  valueChars = 0,
}) {
  const tone = coreIndexTone(point?.core_index_bucket, isDark);
  // Both figures share one fixed width (padded readouts in a monospaced
  // face), so the value column never changes width while scrubbing.
  const figureChars = Math.max(SCORE_CHARS, valueChars);
  // On the right the card ends `rightInset` px from the chart's right edge.
  const shift = Math.max(0, room - rightInset - CARD_LEFT - CARD_WIDTH);

  // Under the sticky HUD (z-30). Shown only while the crosshair is active
  // (mouse, keyboard slider or press-and-hold), so the chart is clear at rest.
  // From sm up it takes the side away from the point being read; it keeps
  // one layout position and moves by a transform, so switching sides is not
  // a layout shift.
  return (
    <div
      className={`pointer-events-none absolute left-4 top-4 z-20 w-[218px] rounded-2xl border border-black/[0.08] bg-white/[0.92] p-3 shadow-[0_24px_80px_rgba(20,18,26,0.18)] backdrop-blur-xl transition-opacity duration-[140ms] starting:opacity-0 dark:border-white/10 dark:bg-[#0b0b12]/[0.92] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)] sm:left-7 ${
        side === "right" ? "sm:translate-x-(--legend-shift)" : ""
      } sm:w-[244px] sm:p-4 ${active ? "block" : "hidden"}`}
      style={{ "--legend-shift": `${shift}px` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-micro font-medium uppercase tracking-[0.2em] text-black/60 dark:text-white/60">
          Hover snapshot
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: tone.color }}
          aria-hidden="true"
        />
      </div>

      <p className="mt-1.5 font-mono text-base font-semibold tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4] sm:text-lg">
        {formatDate(point?.date)}
      </p>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 border-t border-black/[0.08] pt-2.5 dark:border-white/10">
        <LegendRow
          label={asset.label}
          value={padReadout(
            formatNumber(point?.[asset.valueField], asset.precision),
            figureChars,
          )}
          color={assetChartColor(asset, isDark)}
        />
        <LegendRow
          label="Core Index"
          value={padReadout(formatSigned(point?.core_index), figureChars)}
          color={tone.color}
        />
      </div>

      <div className="mt-2 border-t border-black/[0.08] pt-2 dark:border-white/10">
        <p
          className="truncate text-micro font-medium uppercase tracking-[0.14em]"
          style={{ color: tone.color }}
        >
          {tone.label}
        </p>
        <p className="mt-0.5 truncate text-micro text-black/60 dark:text-white/60">
          Contrarian: {tone.action}
        </p>
      </div>
    </div>
  );
}
