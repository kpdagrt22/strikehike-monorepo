"use client";

import { useMemo, useState } from "react";
import {
  areaFromSegment,
  buildSegments,
  clamp,
  decadeTicks,
  formatDate,
  getChartTone,
  parseIsoDay,
  pathFromSegment,
} from "@/components/regime/regimeUtils";

const WIDTH = 1280;
const HEIGHT = 430;
const PAD = { top: 30, right: 70, bottom: 46, left: 66 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const STRENGTH_TICKS = [0, 25, 50, 75, 100];
const EQUITY_TICKS = [100, 1_000, 10_000, 100_000];
const DAY_MS = 86_400_000;

function Legend({ tone }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-micro text-black/55 dark:text-white/55">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-0.5 w-4 rounded-full"
          style={{ backgroundColor: tone.equity }}
        />
        Equity proxy
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-0.5 w-4 rounded-full"
          style={{ backgroundColor: tone.strength }}
        />
        Macro strength
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 rounded-[2px]"
          style={{ backgroundColor: tone.crimson, opacity: 0.35 }}
        />
        NBER recession
      </span>
    </div>
  );
}

export function RegimeTimeline({
  timeline,
  crashes,
  selectedId,
  onSelect,
  isDark,
  coverage,
}) {
  const [hoveredId, setHoveredId] = useState(null);
  const tone = useMemo(() => getChartTone(isDark), [isDark]);

  const geometry = useMemo(() => {
    if (!Array.isArray(timeline) || timeline.length === 0) return null;

    const points = timeline
      .map((point) => ({ ...point, ms: parseIsoDay(point.date) }))
      .filter((point) => point.ms != null);
    if (points.length === 0) return null;

    const startMs = points[0].ms;
    const endMs = points[points.length - 1].ms;
    const span = Math.max(1, endMs - startMs);
    const x = (ms) =>
      PAD.left + clamp((ms - startMs) / span, 0, 1) * PLOT_W;

    const yStrength = (value) =>
      PAD.top + PLOT_H - (clamp(value, 0, 100) / 100) * PLOT_H;

    const equityPoints = points.filter(
      (point) =>
        Number.isFinite(point.sp500_proxy) && point.sp500_proxy > 0,
    );
    const firstEquity = equityPoints[0]?.sp500_proxy ?? null;
    const rebased = firstEquity
      ? equityPoints.map((point) => ({
          ...point,
          equity: (point.sp500_proxy / firstEquity) * 100,
        }))
      : [];
    const values = rebased.map((point) => point.equity);
    const minLog = values.length ? Math.log10(Math.min(...values)) : 0;
    const maxLog = values.length ? Math.log10(Math.max(...values)) : 1;
    const logSpan = Math.max(0.0001, maxLog - minLog);
    const yEquity = (value) =>
      PAD.top + PLOT_H - ((Math.log10(value) - minLog) / logSpan) * PLOT_H;

    const equitySegments = buildSegments(
      rebased,
      (point) => point.equity,
      (point) => x(point.ms),
      yEquity,
    );
    const strengthSegments = buildSegments(
      points,
      (point) => point.strength,
      (point) => x(point.ms),
      yStrength,
    );

    const ticks = decadeTicks(startMs, endMs, 25);
    const equityTicks = EQUITY_TICKS.filter((value) => {
      const log = Math.log10(value);
      return log >= minLog && log <= maxLog;
    });

    return {
      startMs,
      endMs,
      x,
      yStrength,
      yEquity,
      equitySegments,
      strengthSegments,
      ticks,
      equityTicks,
      firstEquity,
    };
  }, [timeline]);

  if (!geometry) return null;

  const {
    startMs,
    endMs,
    x,
    yStrength,
    yEquity,
    equitySegments,
    strengthSegments,
    ticks,
    equityTicks,
    firstEquity,
  } = geometry;
  const baseline = PAD.top + PLOT_H;
  const startYear = new Date(startMs).getUTCFullYear();
  const endYear = new Date(endMs).getUTCFullYear();
  const axisTicks = ticks.filter(
    (tick) => tick.year > startYear + 5 && tick.year < endYear - 5,
  );
  const fullStrengthFrom = (timeline ?? []).find(
    (point) => (point.strength_coverage ?? 0) >= 0.99,
  )?.date;

  const windows = (crashes ?? [])
    .map((crash) => {
      const start = parseIsoDay(crash.start);
      const end = parseIsoDay(crash.end);
      if (start == null || end == null) return null;
      const x0 = x(Math.max(start, startMs));
      const x1 = x(Math.min(end + DAY_MS, endMs));
      const width = Math.max(2.5, x1 - x0);
      return { crash, x0, width };
    })
    .filter(Boolean);

  return (
    <section
      aria-labelledby="regime-timeline-title"
      className="mt-4 overflow-hidden rounded-[1.6rem] border border-black/10 bg-white/70 shadow-[0_18px_60px_rgba(20,18,26,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-black/70 dark:shadow-[0_18px_60px_rgba(0,0,0,0.5)] lg:bg-white/45 lg:dark:bg-black/25"
    >
      <div className="flex flex-col gap-3 border-b border-black/[0.07] p-5 dark:border-white/10 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div>
          <p className="text-micro uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
            120-year regime timeline
          </p>
          <h2
            id="regime-timeline-title"
            className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4] sm:text-2xl"
          >
            Equity proxy and macro strength, {startYear}–{endYear}
          </h2>
          <p className="mt-1 text-micro text-black/45 dark:text-white/45">
            Click a crimson NBER window to open the daily crash dossier.
          </p>
        </div>
        <Legend tone={tone} />
      </div>

      <p className="px-5 pt-3 text-micro text-black/35 dark:text-white/35 sm:hidden">
        Swipe horizontally to explore the full 1854–2026 axis.
      </p>

      <div className="overflow-x-auto p-2 sm:p-4">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[860px]"
          role="img"
          aria-label={`${startYear} to ${endYear} equity proxy and macro strength timeline with ${crashes?.length ?? 0} shaded NBER recession windows`}
        >
          <defs>
            <linearGradient
              id="regime-strength-fill"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={tone.strength}
                stopOpacity="0.16"
              />
              <stop
                offset="100%"
                stopColor={tone.strength}
                stopOpacity="0"
              />
            </linearGradient>
            <filter
              id="regime-equity-glow"
              x="-10%"
              y="-10%"
              width="120%"
              height="120%"
            >
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {STRENGTH_TICKS.map((tick) => {
            const y = yStrength(tick);
            return (
              <g key={`strength-${tick}`}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={y}
                  y2={y}
                  stroke={tone.grid}
                  strokeDasharray={tick === 50 ? "3 5" : undefined}
                />
                <text
                  x={WIDTH - PAD.right + 10}
                  y={y + 3}
                  fill={tone.axis}
                  fontSize="10"
                  className="font-mono"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {equityTicks.map((tick) => {
            const y = yEquity(tick);
            return (
              <g key={`equity-${tick}`}>
                <text
                  x={PAD.left - 10}
                  y={y + 3}
                  fill={tone.axis}
                  fontSize="10"
                  textAnchor="end"
                  className="font-mono"
                >
                  {tick >= 1_000 ? `${tick / 1_000}k` : tick}
                </text>
              </g>
            );
          })}

          {axisTicks.map((tick) => (
            <g key={`year-${tick.year}`}>
              <line
                x1={x(tick.ms)}
                x2={x(tick.ms)}
                y1={PAD.top}
                y2={baseline}
                stroke={tone.grid}
              />
              <text
                x={x(tick.ms)}
                y={HEIGHT - 14}
                fill={tone.axis}
                fontSize="10"
                textAnchor="middle"
                className="font-mono"
              >
                {tick.year}
              </text>
            </g>
          ))}

          <text
            x={PAD.left}
            y={HEIGHT - 14}
            fill={tone.axisStrong}
            fontSize="10"
            className="font-mono"
          >
            {startYear}
          </text>
          <text
            x={WIDTH - PAD.right}
            y={HEIGHT - 14}
            fill={tone.axisStrong}
            fontSize="10"
            textAnchor="end"
            className="font-mono"
          >
            {endYear}
          </text>

          {equitySegments.map((segment, index) => (
            <path
              key={`equity-segment-${index}`}
              d={pathFromSegment(segment)}
              fill="none"
              stroke={tone.equity}
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.95"
              filter="url(#regime-equity-glow)"
            />
          ))}

          {strengthSegments.map((segment, index) => (
            <path
              key={`strength-area-${index}`}
              d={areaFromSegment(segment, baseline)}
              fill="url(#regime-strength-fill)"
            />
          ))}

          {strengthSegments.map((segment, index) => (
            <path
              key={`strength-line-${index}`}
              d={pathFromSegment(segment)}
              fill="none"
              stroke={tone.strength}
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.8"
            />
          ))}

          {windows.map(({ crash, x0, width }) => {
            const selected = crash.id === selectedId;
            const hovered = crash.id === hoveredId;
            const showLabel = selected || hovered;
            const labelRight = x0 + width > WIDTH - PAD.right - 190;
            const labelX = labelRight ? x0 + width - 4 : x0 + 4;

            return (
              <g
                key={crash.id}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${crash.name}, ${crash.start} to ${crash.end}`}
                className="cursor-pointer outline-none"
                onClick={() => onSelect(crash)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(crash);
                  }
                }}
                onMouseEnter={() => setHoveredId(crash.id)}
                onMouseLeave={() =>
                  setHoveredId((current) =>
                    current === crash.id ? null : current,
                  )
                }
                onFocus={() => setHoveredId(crash.id)}
                onBlur={() =>
                  setHoveredId((current) =>
                    current === crash.id ? null : current,
                  )
                }
              >
                <rect
                  x={x0}
                  y={PAD.top}
                  width={width}
                  height={PLOT_H}
                  fill={tone.crimson}
                  fillOpacity={selected ? 0.38 : hovered ? 0.28 : 0.2}
                  stroke={selected || hovered ? tone.crimson : "transparent"}
                  strokeOpacity={selected ? 0.6 : hovered ? 0.45 : 0}
                  className="transition-[fill-opacity] duration-200"
                />
                <rect
                  x={x0 - 3}
                  y={PAD.top}
                  width={width + 6}
                  height={PLOT_H}
                  fill="transparent"
                  pointerEvents="all"
                />
                {showLabel ? (
                  <text
                    x={labelX}
                    y={PAD.top - 9}
                    fill={tone.axisStrong}
                    fontSize="10"
                    textAnchor={labelRight ? "end" : "start"}
                    className="font-mono"
                  >
                    {crash.name}
                  </text>
                ) : null}
                <title>
                  {crash.name} · {crash.start} → {crash.end}
                </title>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-col gap-1 border-t border-black/[0.07] px-5 py-3 text-micro text-black/45 dark:border-white/10 dark:text-white/45 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {formatDate(coverage?.start)} → {formatDate(coverage?.end)} ·{" "}
          {crashes?.length ?? 0} NBER windows
        </span>
        <span>
          {firstEquity != null
            ? "Equity proxy rebased to 100 at first observation; log scale."
            : "No equity proxy in this window."}{" "}
          {fullStrengthFrom
            ? `Strength is Fed-only before ${formatDate(fullStrengthFrom)}.`
            : "Strength coverage is partial."}
        </span>
      </div>
    </section>
  );
}
