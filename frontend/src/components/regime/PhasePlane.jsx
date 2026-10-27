"use client";

import { useMemo } from "react";
import {
  bravosTone,
  clamp,
  formatDate,
  formatPercent,
  formatSigned,
  getChartTone,
} from "@/components/regime/regimeUtils";
import {
  assetChartColor,
  getAssetTarget,
} from "@/components/regime/assetTargets";

const WIDTH = 760;
const HEIGHT = 420;
const PAD = { top: 30, right: 30, bottom: 52, left: 58 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const VOL_THRESHOLD = 50;
const DRAWDOWN_THRESHOLD = -10;

function Quadrant({
  x,
  y,
  width,
  height,
  fill,
  label,
  detail,
  tone,
  strong,
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={strong ? 0.16 : 0.075}
      />
      <text
        x={x + width / 2}
        y={y + height / 2 - 2}
        fill={tone}
        fontSize="10"
        textAnchor="middle"
        className="font-mono font-semibold tracking-[0.14em]"
      >
        {label}
      </text>
      <text
        x={x + width / 2}
        y={y + height / 2 + 12}
        fill={tone}
        fillOpacity="0.55"
        fontSize="8"
        textAnchor="middle"
        className="font-mono"
      >
        {detail}
      </text>
    </g>
  );
}

export function PhasePlane({
  point,
  asOf,
  contextLabel,
  isDark,
  assetKey = "sp500",
}) {
  const tone = useMemo(() => getChartTone(isDark), [isDark]);
  const asset = useMemo(() => getAssetTarget(assetKey), [assetKey]);
  const assetColor = assetChartColor(asset, isDark);
  const bravos = bravosTone(point?.bravos_bucket, isDark);
  const vol =
    point?.[asset.percentileField] == null
      ? Number.NaN
      : Number(point[asset.percentileField]);
  const drawdown =
    point?.[asset.drawdownField] == null
      ? Number.NaN
      : Number(point[asset.drawdownField]);
  const hasPoint = Number.isFinite(vol) && Number.isFinite(drawdown);
  const markerColor = point?.bravos_bucket ? bravos.color : assetColor;

  const yMin = Math.min(-40, (hasPoint ? drawdown : -10) * 1.15);
  const yTicks = [];
  const floor = Math.ceil(yMin / 10) * 10;
  for (let value = 0; value >= floor; value -= 10) yTicks.push(value);

  const x = (value) =>
    PAD.left + (clamp(value, 0, 100) / 100) * PLOT_W;
  const y = (value) =>
    PAD.top + (clamp(value, yMin, 0) / yMin) * PLOT_H;
  const thresholdY = y(DRAWDOWN_THRESHOLD);
  const thresholdX = x(VOL_THRESHOLD);
  const currentQuadrant =
    !hasPoint
      ? null
      : vol >= VOL_THRESHOLD && drawdown <= DRAWDOWN_THRESHOLD
        ? "crisis"
        : vol >= VOL_THRESHOLD
          ? "choppy"
          : drawdown <= DRAWDOWN_THRESHOLD
            ? "grind"
            : "calm";

  return (
    <section
      aria-labelledby="phase-plane-title"
      className="overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/45 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-2xl dark:border-white/5 dark:bg-black/40 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
    >
      <div className="border-b border-black/5 p-5 dark:border-white/5 sm:p-6">
        <p className="text-micro uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
          Phase plane · {asset.label}
        </p>
        <h2
          id="phase-plane-title"
          className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4] sm:text-2xl"
        >
          The 2×2 volatility map
        </h2>
        <p className="mt-1 text-micro text-black/45 dark:text-white/45">
          {formatDate(asOf)} · {contextLabel} · one-year volatility percentile
          vs drawdown from the one-year high
        </p>
      </div>

      <div className="overflow-x-auto p-2 sm:p-3">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[560px]"
          role="img"
          aria-label={`Two by two phase plane of ${asset.label} volatility percentile versus one-year drawdown as of ${formatDate(asOf)}`}
        >
          <defs>
            <radialGradient id="phase-marker-glow">
              <stop offset="0%" stopColor={markerColor} stopOpacity="0.42" />
              <stop offset="100%" stopColor={markerColor} stopOpacity="0" />
            </radialGradient>
          </defs>

          <Quadrant
            x={PAD.left}
            y={PAD.top}
            width={PLOT_W / 2}
            height={thresholdY - PAD.top}
            fill={isDark ? "#5eead4" : "#0f766e"}
            label="CALM"
            detail="low vol · shallow"
            tone={tone.axisStrong}
            strong={currentQuadrant === "calm"}
          />
          <Quadrant
            x={thresholdX}
            y={PAD.top}
            width={PLOT_W / 2}
            height={thresholdY - PAD.top}
            fill={isDark ? "#fbbf24" : "#b45309"}
            label="CHOPPY"
            detail="high vol · shallow"
            tone={tone.axisStrong}
            strong={currentQuadrant === "choppy"}
          />
          <Quadrant
            x={PAD.left}
            y={thresholdY}
            width={PLOT_W / 2}
            height={PAD.top + PLOT_H - thresholdY}
            fill={isDark ? "#60a5fa" : "#2563eb"}
            label="GRIND"
            detail="low vol · deep"
            tone={tone.axisStrong}
            strong={currentQuadrant === "grind"}
          />
          <Quadrant
            x={thresholdX}
            y={thresholdY}
            width={PLOT_W / 2}
            height={PAD.top + PLOT_H - thresholdY}
            fill={isDark ? "#fb7185" : "#c0442f"}
            label="CRISIS"
            detail="high vol · deep"
            tone={isDark ? "#fda4af" : "#c0442f"}
            strong={currentQuadrant === "crisis"}
          />

          {[0, 25, 50, 75, 100].map((tick) => (
            <g key={`phase-x-${tick}`}>
              <line
                x1={x(tick)}
                x2={x(tick)}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                stroke={tone.grid}
                strokeOpacity={tick === VOL_THRESHOLD ? 0.65 : 0.4}
                strokeDasharray={tick === VOL_THRESHOLD ? "3 4" : undefined}
              />
              <text
                x={x(tick)}
                y={HEIGHT - 28}
                fill={tone.axis}
                fontSize="9"
                textAnchor="middle"
                className="font-mono"
              >
                {tick}
              </text>
            </g>
          ))}

          {yTicks.map((tick) => (
            <g key={`phase-y-${tick}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT_W}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tone.grid}
                strokeOpacity={tick === DRAWDOWN_THRESHOLD ? 0.65 : 0.4}
                strokeDasharray={
                  tick === DRAWDOWN_THRESHOLD ? "3 4" : undefined
                }
              />
              <text
                x={PAD.left - 9}
                y={y(tick) + 3}
                fill={tone.axis}
                fontSize="9"
                textAnchor="end"
                className="font-mono"
              >
                {tick}%
              </text>
            </g>
          ))}

          <text
            x={PAD.left + PLOT_W / 2}
            y={HEIGHT - 8}
            fill={tone.axisStrong}
            fontSize="9"
            textAnchor="middle"
            className="font-mono"
          >
            1Y VOLATILITY PERCENTILE →
          </text>
          <text
            x={16}
            y={PAD.top + PLOT_H / 2}
            fill={tone.axisStrong}
            fontSize="9"
            textAnchor="middle"
            transform={`rotate(-90 16 ${PAD.top + PLOT_H / 2})`}
            className="font-mono"
          >
            DRAWDOWN FROM 1Y HIGH ↓
          </text>

          {hasPoint ? (
            <g>
              <circle
                cx={x(vol)}
                cy={y(drawdown)}
                r="28"
                fill="url(#phase-marker-glow)"
              />
              <circle
                cx={x(vol)}
                cy={y(drawdown)}
                r="5.5"
                fill={markerColor}
                stroke={isDark ? "#020204" : "#f1ebe2"}
                strokeWidth="2"
              />
              <text
                x={x(vol) + (vol > 80 ? -10 : 10)}
                y={y(drawdown) - 10}
                fill={markerColor}
                fontSize="9"
                textAnchor={vol > 80 ? "end" : "start"}
                className="font-mono"
              >
                {formatDate(asOf)}
              </text>
            </g>
          ) : (
            <text
              x={PAD.left + PLOT_W / 2}
              y={PAD.top + PLOT_H / 2}
              fill={tone.axis}
              fontSize="10"
              textAnchor="middle"
              className="font-mono"
            >
              No serialized phase features for this date
            </text>
          )}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-black/5 px-4 py-3 dark:border-white/5 sm:grid-cols-4">
        <div>
          <p className="text-micro uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
            Vol
          </p>
          <p className="mt-0.5 font-mono text-meta text-[#14121a] dark:text-[#f2ede4]">
            {hasPoint ? `${Math.round(vol)}th pct` : "—"}
          </p>
        </div>
        <div>
          <p className="text-micro uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
            Drawdown
          </p>
          <p className="mt-0.5 font-mono text-meta text-[#14121a] dark:text-[#f2ede4]">
            {hasPoint ? formatPercent(drawdown, 1) : "—"}
          </p>
        </div>
        <div>
          <p className="text-micro uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
            Bravos
          </p>
          <p
            className="mt-0.5 font-mono text-meta"
            style={{ color: markerColor }}
          >
            {formatSigned(point?.bravos_score)}
          </p>
        </div>
        <div>
          <p className="text-micro uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
            Quadrant
          </p>
          <p className="mt-0.5 font-mono text-meta uppercase text-[#14121a] dark:text-[#f2ede4]">
            {currentQuadrant ?? "—"}
          </p>
        </div>
      </div>

      <p className="border-t border-black/5 px-4 py-3 text-micro leading-relaxed text-black/40 dark:border-white/5 dark:text-white/40">
        The 2×2 grid uses a 50th percentile volatility threshold and a −10%
        drawdown threshold. Quadrants are descriptive, not trading signals.
        Gold, bond and Bitcoin points use the same serialized target features.
      </p>
    </section>
  );
}
