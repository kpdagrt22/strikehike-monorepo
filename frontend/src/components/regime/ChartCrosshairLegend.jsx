"use client";

import {
  bravosTone,
  formatDate,
  formatNumber,
  formatSigned,
} from "@/components/regime/regimeUtils";
import {
  ASSET_ORDER,
  ASSET_TARGETS,
  assetChartColor,
} from "@/components/regime/assetTargets";

function LegendRow({ label, value, color }) {
  return (
    <>
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/40">
        {label}
      </span>
      <span
        className="text-right font-mono text-micro font-semibold tracking-[-0.02em] text-white/85"
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
  compareAssets = false,
}) {
  const tone = bravosTone(point?.bravos_bucket, true);
  const glow = `0 0 22px ${tone.color}55`;
  const assets = compareAssets
    ? ASSET_ORDER.map((key) => ASSET_TARGETS[key])
    : [asset];

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-30 w-[218px] rounded-2xl border border-white/10 bg-black/60 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:left-7 sm:w-[244px] sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
          Crosshair readout
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: tone.color, boxShadow: glow }}
          aria-hidden="true"
        />
      </div>

      <p className="mt-1.5 font-mono text-base font-semibold tracking-[-0.04em] text-white/90 sm:text-lg">
        {point?.date ?? "—"}
      </p>
      <p className="text-micro text-white/35">{formatDate(point?.date)}</p>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-white/10 pt-2.5">
        {assets.map((target) => (
          <LegendRow
            key={target.key}
            label={target.label}
            value={formatNumber(
              point?.[target.valueField],
              target.precision,
            )}
            color={assetChartColor(target, true)}
          />
        ))}
        <LegendRow
          label="Bravos"
          value={formatSigned(point?.bravos_score)}
          color={tone.color}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-2">
        <span
          className="truncate text-[10px] font-medium uppercase tracking-[0.14em]"
          style={{ color: tone.color }}
        >
          {tone.label}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-white/30">
          −50 / +50
        </span>
      </div>
    </div>
  );
}
