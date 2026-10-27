"use client";

import {
  bravosTone,
  formatDate,
  formatNumber,
  formatPercent,
  formatScore,
  formatSigned,
} from "@/components/regime/regimeUtils";
import {
  ASSET_ORDER,
  ASSET_TARGETS,
  assetChartColor,
} from "@/components/regime/assetTargets";

function Metric({ label, value, accent, detail }) {
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
      {detail ? (
        <p className="mt-0.5 truncate text-[10px] text-black/30 dark:text-white/30">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function pillarAccent(value, isDark) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  if (Number(value) >= 60) return isDark ? "#5eead4" : "#0f766e";
  if (Number(value) <= 40) return isDark ? "#fb7185" : "#c0442f";
  return isDark ? "#fbbf24" : "#b45309";
}

export function MacroHUD({
  point,
  isDark,
  resolution,
  activeCrash,
  asset = ASSET_TARGETS.sp500,
  assetKey = "sp500",
  onAssetChange,
  forecast,
  compareAssets = false,
  onCompareToggle,
}) {
  const tone = bravosTone(point?.bravos_bucket, isDark);
  const glow = `0 0 28px ${tone.color}66, 0 0 64px ${tone.color}24`;
  const risk = forecast?.risk_pct;
  const riskColor =
    risk == null
      ? isDark
        ? "#9ca3af"
        : "#6b7280"
      : risk < 10
        ? isDark
          ? "#5eead4"
          : "#0f766e"
        : risk < 33
          ? isDark
            ? "#fbbf24"
            : "#b45309"
          : isDark
            ? "#fb7185"
            : "#c0442f";
  const assetValue = point?.[asset.valueField];
  const macroAccent = pillarAccent(point?.macro_score, isDark);
  const volAccent = pillarAccent(point?.bravos_volatility_score, isDark);
  const momentumAccent = pillarAccent(
    point?.bravos_momentum_score,
    isDark,
  );
  const creditAccent =
    point?.hy_oas == null
      ? null
      : Number(point.hy_oas) >= 8
        ? isDark
          ? "#fb7185"
          : "#c0442f"
        : Number(point.hy_oas) <= 4
          ? isDark
            ? "#5eead4"
            : "#0f766e"
          : isDark
            ? "#fbbf24"
            : "#b45309";

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-2.5 pt-3 sm:px-5 sm:pb-4 sm:pt-5 lg:px-8">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap sm:gap-x-8 sm:gap-y-4">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-black/35 dark:text-white/35">
              Bravos composite
            </p>
            <div className="mt-1 flex items-end gap-1.5 sm:gap-2">
              <span
                className="font-mono text-[2.9rem] font-medium leading-[0.78] tracking-[-0.075em] sm:text-[4rem]"
                style={{ color: tone.color, textShadow: glow }}
              >
                {formatSigned(point?.bravos_score)}
              </span>
              <span className="pb-1 font-mono text-micro text-black/30 dark:text-white/30">
                / +50
              </span>
            </div>
            <p className="mt-1 font-mono text-[10px] text-black/30 dark:text-white/30">
              −50 ↔ +50 · zero is neutral
            </p>
          </div>

          <div className="min-w-0 border-l border-black/5 pl-3 dark:border-white/5 sm:min-w-[190px] sm:pl-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-black/35 dark:text-white/35">
              Signal
            </p>
            <p
              className="mt-1 text-xl font-semibold leading-none tracking-[-0.05em] sm:text-3xl"
              style={{ color: tone.color, textShadow: glow }}
            >
              {tone.label}
            </p>
            <p className="mt-1.5 max-w-[280px] truncate text-micro text-black/40 dark:text-white/40">
              {activeCrash
                ? `${activeCrash.name} · NBER window`
                : point
                  ? "Crosshair readout · hover the chart"
                  : "Awaiting macro archive"}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 xl:items-end">
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              role="group"
              aria-label="Primary asset"
              className="inline-flex items-center gap-0.5 rounded-full border border-black/5 bg-black/[0.025] p-0.5 backdrop-blur-2xl dark:border-white/5 dark:bg-white/[0.035]"
            >
              {ASSET_ORDER.map((key) => {
                const target = ASSET_TARGETS[key];
                const selected = key === assetKey;
                const color = assetChartColor(target, isDark);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onAssetChange?.(key)}
                    aria-pressed={selected}
                    className={`rounded-full px-2.5 py-1 text-micro font-medium transition-[background-color,color,box-shadow] duration-200 ${
                      selected
                        ? ""
                        : "text-black/45 hover:text-black/75 dark:text-white/45 dark:hover:text-white/75"
                    }`}
                    style={
                      selected
                        ? {
                            color,
                            backgroundColor: `${color}1f`,
                            boxShadow: `0 0 18px ${color}22`,
                          }
                        : undefined
                    }
                  >
                    {target.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onCompareToggle}
              aria-pressed={compareAssets}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-micro font-medium transition-colors ${
                compareAssets
                  ? "border-[#c0442f]/25 bg-[#f05d49]/10 text-[#c0442f] dark:border-[#ff8b77]/25 dark:bg-[#f05d49]/15 dark:text-[#ff8b77]"
                  : "border-black/5 text-black/50 hover:bg-black/[0.04] hover:text-black/75 dark:border-white/5 dark:text-white/50 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 17l5-6 4 4 7-9" />
                <path d="M4 21h16" />
              </svg>
              Compare assets
            </button>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 xl:justify-end">
            <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-black/35 dark:text-white/35">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: tone.color, boxShadow: glow }}
                aria-hidden="true"
              />
              Snapshot
            </span>
            <p className="font-mono text-lg font-medium tracking-[-0.03em] text-black/75 dark:text-white/80">
              {formatDate(point?.date)}
            </p>
            <p className="text-micro text-black/35 dark:text-white/35">
              {resolution ? `${resolution} tape` : "Macro tape"} · hover to
              scrub
            </p>
          </div>

          <div
            className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-black/[0.025] px-3 py-1.5 backdrop-blur-2xl dark:border-white/5 dark:bg-white/[0.035]"
            title={
              forecast
                ? `${forecast.model} · ${forecast.as_of} · ${forecast.training?.observations ?? "—"} training obs`
                : "30-day regime forecast is loading"
            }
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: riskColor,
                boxShadow: `0 0 18px ${riskColor}55`,
              }}
              aria-hidden="true"
            />
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-black/35 dark:text-white/35">
              30-Day Disruptive Risk
            </span>
            <span
              className="font-mono text-body font-medium tracking-[-0.02em]"
              style={{ color: riskColor }}
            >
              {risk == null ? "—" : `${formatNumber(risk, 1)}%`}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-black/5 pt-3 dark:border-white/5 sm:mt-4 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-3 lg:grid-cols-5">
        <Metric
          label="Macro pillar"
          value={`${formatScore(point?.macro_score)} / 100`}
          accent={macroAccent}
          detail="Credit · Fed · curve"
        />
        <Metric
          label="Volatility pillar"
          value={`${formatScore(point?.bravos_volatility_score)} / 100`}
          accent={volAccent}
          detail="ATR · Bollinger"
        />
        <Metric
          label="Momentum pillar"
          value={`${formatScore(point?.bravos_momentum_score)} / 100`}
          accent={momentumAccent}
          detail="MACD · RSI"
        />
        <Metric
          label="HY OAS"
          value={formatPercent(point?.hy_oas, 2)}
          accent={creditAccent}
          detail="Credit stress"
        />
        <Metric
          label={asset.metricLabel}
          value={formatNumber(assetValue, asset.precision)}
          detail={compareAssets ? "Compare mode" : asset.unit}
        />
      </div>
    </div>
  );
}
