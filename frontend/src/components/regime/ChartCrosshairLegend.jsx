"use client";

import {
  formatDate,
  formatNumber,
  formatPercent,
  formatScore,
} from "@/components/regime/regimeUtils";
import {
  getRegimeToneColor,
  getRegimeToneLabel,
} from "@/lib/regimeTone";

function LegendRow({ label, value, color, glow }) {
  return (
    <>
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
        {label}
      </span>
      <span
        className="text-right font-mono text-micro font-semibold tracking-[-0.02em] text-white/85"
        style={color ? { color, textShadow: glow } : undefined}
      >
        {value}
      </span>
    </>
  );
}

export function ChartCrosshairLegend({ point }) {
  const toneColor =
    getRegimeToneColor(point?.regime_state, true) ?? "#5eead4";
  const toneLabel = getRegimeToneLabel(point?.regime_state) ?? "—";
  const glow = `0 0 22px ${toneColor}55`;

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-30 w-[214px] rounded-2xl border border-white/10 bg-black/60 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:left-7 sm:w-[248px] sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
          Event readout
        </span>
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: toneColor, boxShadow: glow }}
          aria-hidden="true"
        />
      </div>

      <p className="mt-1.5 font-mono text-base font-semibold tracking-[-0.04em] text-white/90 sm:text-lg">
        {point?.date ?? "—"}
      </p>
      <p className="text-micro text-white/35">{formatDate(point?.date)}</p>

      <div className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 border-t border-white/10 pt-2.5">
        <LegendRow
          label="S&P 500"
          value={formatNumber(point?.sp500_proxy, 2)}
        />
        <LegendRow
          label="Fed funds"
          value={formatPercent(point?.fed_funds, 2)}
        />
        <LegendRow
          label="10Y–2Y"
          value={formatPercent(point?.t10y2y, 2)}
          color={
            point?.t10y2y == null
              ? null
              : Number(point.t10y2y) < 0
                ? "#fb7185"
                : "#5eead4"
          }
        />
        <LegendRow
          label="Strength"
          value={formatScore(point?.strength)}
          color={toneColor}
          glow={glow}
        />
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
        <span
          className="text-[10px] font-medium uppercase tracking-[0.16em]"
          style={{ color: toneColor }}
        >
          {toneLabel}
        </span>
        <span className="font-mono text-[10px] text-white/30">0–100</span>
      </div>
    </div>
  );
}
