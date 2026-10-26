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

function Metric({ label, value, accent }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-black/35 dark:text-white/35">
        {label}
      </p>
      <p
        className="mt-0.5 truncate font-mono text-body font-medium tracking-[-0.02em] text-black/75 dark:text-white/80"
        style={
          accent
            ? {
                color: accent,
                textShadow: `0 0 18px ${accent}33`,
              }
            : undefined
        }
      >
        {value}
      </p>
    </div>
  );
}

export function MacroHUD({ point, isDark, resolution, activeCrash }) {
  const toneColor =
    getRegimeToneColor(point?.regime_state, isDark) ??
    (isDark ? "#f2ede4" : "#14121a");
  const toneLabel = getRegimeToneLabel(point?.regime_state) ?? "No regime";
  const glow = `0 0 28px ${toneColor}66, 0 0 64px ${toneColor}24`;
  const curve = point?.t10y2y;
  const curveAccent =
    curve == null
      ? null
      : Number(curve) < 0
        ? isDark
          ? "#fb7185"
          : "#c0442f"
        : isDark
          ? "#34d399"
          : "#0f766e";
  const volPercentile = point?.["1y_volatility_percentile"];
  const drawdown = point?.drawdown_1y;
  const drawdownAccent =
    drawdown == null
      ? null
      : Number(drawdown) < -10
        ? isDark
          ? "#fb7185"
          : "#c0442f"
        : isDark
          ? "#5eead4"
          : "#0f766e";
  const phase = point?.phase
    ? `${point.phase[0].toUpperCase()}${point.phase.slice(1)}`
    : "—";
  const phaseAccent =
    point?.phase === "recession"
      ? isDark
        ? "#fb7185"
        : "#c0442f"
      : point?.phase === "expansion"
        ? isDark
          ? "#5eead4"
          : "#0f766e"
        : null;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-2.5 pt-3 sm:px-5 sm:pb-4 sm:pt-5 lg:px-8">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end sm:gap-x-8 sm:gap-y-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-black/35 dark:text-white/35">
              Macro strength
            </p>
            <div className="mt-1 flex items-end gap-1.5 sm:gap-2">
              <span
                className="font-mono text-[2.9rem] font-medium leading-[0.78] tracking-[-0.075em] sm:text-[4rem]"
                style={{ color: toneColor, textShadow: glow }}
              >
                {formatScore(point?.strength)}
              </span>
              <span className="pb-1 font-mono text-micro text-black/30 dark:text-white/30">
                / 100
              </span>
            </div>
          </div>

          <div className="min-w-0 border-l border-black/5 pl-3 dark:border-white/5 sm:min-w-[168px] sm:pl-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-black/35 dark:text-white/35">
              Regime state
            </p>
            <p
              className="mt-1 text-xl font-semibold leading-none tracking-[-0.05em] sm:text-3xl"
              style={{ color: toneColor, textShadow: glow }}
            >
              {toneLabel}
            </p>
            <p className="mt-1.5 max-w-[260px] truncate text-micro text-black/40 dark:text-white/40">
              {activeCrash
                ? activeCrash.name
                : point
                  ? "Crosshair readout"
                  : "Awaiting macro archive"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 xl:flex-col xl:items-end">
          <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-black/35 dark:text-white/35">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: toneColor, boxShadow: glow }}
              aria-hidden="true"
            />
            Snapshot
          </span>
          <p className="font-mono text-lg font-medium tracking-[-0.03em] text-black/75 dark:text-white/80">
            {formatDate(point?.date)}
          </p>
          <p className="text-micro text-black/35 dark:text-white/35">
            {resolution ? `${resolution} tape` : "Macro tape"} · hover to scrub
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5 border-t border-black/5 pt-3 dark:border-white/5 sm:mt-4 sm:gap-x-4 sm:gap-y-3 lg:grid-cols-6">
        <Metric
          label="Fed funds"
          value={formatPercent(point?.fed_funds, 2)}
        />
        <Metric label="10Y–2Y" value={formatPercent(curve, 2)} accent={curveAccent} />
        <Metric
          label="1Y vol %ile"
          value={volPercentile == null ? "—" : formatNumber(volPercentile, 1)}
        />
        <Metric
          label="1Y drawdown"
          value={formatPercent(drawdown, 2)}
          accent={drawdownAccent}
        />
        <Metric
          label="Equity proxy"
          value={formatNumber(point?.sp500_proxy, 0)}
        />
        <Metric label="NBER phase" value={phase} accent={phaseAccent} />
      </div>
    </div>
  );
}
