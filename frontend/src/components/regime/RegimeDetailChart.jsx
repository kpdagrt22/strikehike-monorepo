"use client";

import { useMemo } from "react";
import {
  areaFromSegment,
  buildSegments,
  clamp,
  formatDate,
  getChartTone,
  parseIsoDay,
  pathFromSegment,
} from "@/components/regime/regimeUtils";

const WIDTH = 920;
const HEIGHT = 250;
const PAD = { top: 28, right: 52, bottom: 34, left: 54 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const CORE_INDEX_TICKS = [-50, 0, 50];
const EQUITY_TICKS = [100, 1_000, 10_000, 100_000];
const DAY_MS = 86_400_000;

function Legend({ tone }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-black/45 dark:text-white/45">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-0.5 w-3 rounded-full"
          style={{ backgroundColor: tone.equity }}
        />
        Equity proxy
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-0.5 w-3 rounded-full"
          style={{ backgroundColor: tone.strength }}
        />
        Core Index
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-[2px]"
          style={{ backgroundColor: tone.crimson, opacity: 0.35 }}
        />
        Recession
      </span>
    </div>
  );
}

export function RegimeDetailChart({ timeline, crash, isDark }) {
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
    const yCoreIndex = (value) =>
      PAD.top + PLOT_H - ((clamp(value, -50, 50) + 50) / 100) * PLOT_H;

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
    const coreIndexSegments = buildSegments(
      points,
      (point) => point.core_index,
      (point) => x(point.ms),
      yCoreIndex,
    );

    const crashStart = parseIsoDay(crash?.start);
    const crashEnd = parseIsoDay(crash?.end);
    const shadeStart = clamp(crashStart ?? startMs, startMs, endMs);
    const shadeEnd = clamp(
      crashEnd != null ? crashEnd + DAY_MS : endMs,
      startMs,
      endMs,
    );

    const markerCandidates = [
      {
        key: "6m",
        label: "−6m",
        date:
          crash?.pre_crash_indicators?.["6m"]?.as_of ??
          crash?.zoom_window?.start,
        colour: tone.axis,
        emphasise: false,
      },
      {
        key: "3m",
        label: "−3m",
        date: crash?.pre_crash_indicators?.["3m"]?.as_of,
        colour: tone.axis,
        emphasise: false,
      },
      {
        key: "peak",
        label: "Peak",
        date: crash?.start,
        colour: "#f05d49",
        emphasise: true,
      },
    ];
    const markers = markerCandidates
      .map((marker) => {
        const ms = parseIsoDay(marker.date);
        if (ms == null || ms < startMs || ms > endMs) return null;
        return { ...marker, ms, x: x(ms) };
      })
      .filter(Boolean);

    const equityTicks = EQUITY_TICKS.filter((value) => {
      const log = Math.log10(value);
      return log >= minLog && log <= maxLog;
    });

    return {
      startMs,
      endMs,
      x,
      yCoreIndex,
      yEquity,
      equitySegments,
      coreIndexSegments,
      shadeStart,
      shadeEnd,
      markers,
      equityTicks,
    };
  }, [timeline, crash, tone.axis]);

  if (!geometry) {
    return (
      <div className="grid h-[220px] place-items-center rounded-2xl border border-dashed border-black/5 text-micro text-black/45 dark:border-white/5 dark:text-white/45">
        No daily observations returned for this window.
      </div>
    );
  }

  const {
    startMs,
    endMs,
    x,
    yCoreIndex,
    yEquity,
    equitySegments,
    coreIndexSegments,
    shadeStart,
    shadeEnd,
    markers,
    equityTicks,
  } = geometry;
  const baseline = PAD.top + PLOT_H;
  const hasSeries =
    equitySegments.length > 0 || coreIndexSegments.length > 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-black/5 bg-white/45 dark:border-white/5 dark:bg-black/25">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/5 px-4 py-3 dark:border-white/5">
        <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/45 dark:text-white/45">
          Daily window · {timeline.length} observations
        </p>
        <Legend tone={tone} />
      </div>

      <div className="overflow-x-auto p-2 sm:p-3">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[620px]"
          role="img"
          aria-label={`Daily equity proxy and Core Index score around ${crash?.name ?? "the selected recession"}`}
        >
          <defs>
            <linearGradient
              id="regime-detail-core-index-fill"
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop
                offset="0%"
                stopColor={tone.strength}
                stopOpacity="0.24"
              />
              <stop
                offset="100%"
                stopColor={tone.strength}
                stopOpacity="0"
              />
            </linearGradient>
          </defs>

          {CORE_INDEX_TICKS.map((tick) => {
            const y = yCoreIndex(tick);
            return (
              <g key={`detail-core-index-${tick}`}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={y}
                  y2={y}
                  stroke={tone.grid}
                  strokeDasharray={tick === 0 ? "3 5" : undefined}
                />
                <text
                  x={WIDTH - PAD.right + 8}
                  y={y + 3}
                  fill={tone.axis}
                  fontSize="9"
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
              <text
                key={`detail-equity-${tick}`}
                x={PAD.left - 8}
                y={y + 3}
                fill={tone.axis}
                fontSize="9"
                textAnchor="end"
                className="font-mono"
              >
                {tick >= 1_000 ? `${tick / 1_000}k` : tick}
              </text>
            );
          })}

          <rect
            x={x(shadeStart)}
            y={PAD.top}
            width={Math.max(2, x(shadeEnd) - x(shadeStart))}
            height={PLOT_H}
            fill={tone.crimson}
            fillOpacity="0.18"
          />

          {equitySegments.map((segment, index) => (
            <path
              key={`detail-equity-segment-${index}`}
              d={pathFromSegment(segment)}
              fill="none"
              stroke={tone.equity}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {coreIndexSegments.map((segment, index) => (
            <path
              key={`detail-core-index-area-${index}`}
              d={areaFromSegment(segment, baseline)}
              fill="url(#regime-detail-core-index-fill)"
            />
          ))}

          {coreIndexSegments.map((segment, index) => (
            <path
              key={`detail-core-index-line-${index}`}
              d={pathFromSegment(segment)}
              fill="none"
              stroke={tone.strength}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {markers.map((marker) => (
            <g key={`detail-marker-${marker.key}`}>
              <line
                x1={marker.x}
                x2={marker.x}
                y1={PAD.top}
                y2={baseline}
                stroke={marker.colour}
                strokeOpacity={marker.emphasise ? 0.8 : 0.45}
                strokeDasharray={marker.emphasise ? undefined : "2 4"}
              />
              <text
                x={marker.x + (marker.key === "6m" ? 3 : 0)}
                y={PAD.top - 8}
                fill={marker.colour}
                fontSize="9"
                textAnchor={marker.key === "6m" ? "start" : "middle"}
                className="font-mono"
              >
                {marker.label}
              </text>
            </g>
          ))}

          <text
            x={PAD.left}
            y={HEIGHT - 10}
            fill={tone.axisStrong}
            fontSize="9"
            className="font-mono"
          >
            {formatDate(startMs)}
          </text>
          <text
            x={WIDTH - PAD.right}
            y={HEIGHT - 10}
            fill={tone.axisStrong}
            fontSize="9"
            textAnchor="end"
            className="font-mono"
          >
            {formatDate(endMs)}
          </text>

          {!hasSeries ? (
            <text
              x={WIDTH / 2}
              y={PAD.top + PLOT_H / 2}
              fill={tone.axis}
              fontSize="11"
              textAnchor="middle"
              className="font-mono"
            >
              No numeric series in this window
            </text>
          ) : null}
        </svg>
      </div>
    </div>
  );
}
