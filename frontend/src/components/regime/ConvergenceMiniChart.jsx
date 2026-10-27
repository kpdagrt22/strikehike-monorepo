"use client";

import { useMemo } from "react";
import {
  buildSegments,
  clamp,
  formatDate,
  getChartTone,
  parseIsoDay,
  pathFromSegment,
} from "@/components/regime/regimeUtils";
import {
  assetChartColor,
  getAssetTarget,
} from "@/components/regime/assetTargets";

const WIDTH = 560;
// Labels render as HTML (SVG text shrinks with the viewBox); the plot area is unchanged.
const HEIGHT = 146;
const PAD = { top: 22, right: 10, bottom: 6, left: 30 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

function pct(value, total) {
  return `${(value / total) * 100}%`;
}

export function ConvergenceMiniChart({
  timeline,
  assetKey = "sp500",
  event,
  isDark,
}) {
  const tone = useMemo(() => getChartTone(isDark), [isDark]);
  const asset = useMemo(() => getAssetTarget(assetKey), [assetKey]);
  const color = assetChartColor(asset, isDark);

  const geometry = useMemo(() => {
    if (!Array.isArray(timeline) || timeline.length === 0) return null;
    const points = timeline
      .map((point) => ({
        ...point,
        ms: parseIsoDay(point.date),
        value: Number(point[asset.valueField]),
      }))
      .filter(
        (point) =>
          point.ms != null &&
          Number.isFinite(point.value) &&
          point.value > 0,
      );
    if (points.length === 0) return null;

    const startMs = parseIsoDay(event?.window?.start) ?? points[0].ms;
    const endMs =
      parseIsoDay(event?.window?.end) ?? points[points.length - 1].ms;
    const span = Math.max(1, endMs - startMs);
    const x = (ms) =>
      PAD.left + clamp((ms - startMs) / span, 0, 1) * PLOT_W;

    const base = points[0].value;
    const normalized = points.map((point) => ({
      ...point,
      index: (point.value / base) * 100,
    }));
    const values = normalized.map((point) => point.index);
    const minLog = Math.log10(Math.min(...values));
    const maxLog = Math.log10(Math.max(...values));
    const logSpan = Math.max(0.0001, maxLog - minLog);
    const y = (value) =>
      PAD.top + PLOT_H - ((Math.log10(value) - minLog) / logSpan) * PLOT_H;
    const segments = buildSegments(
      normalized,
      (point) => point.index,
      (point) => x(point.ms),
      y,
    );

    const peakMs = parseIsoDay(event?.peak);
    const troughMs = parseIsoDay(event?.trough);
    const markers = [
      peakMs != null && peakMs >= startMs && peakMs <= endMs
        ? { key: "peak", ms: peakMs, label: "peak", color: tone.crimson }
        : null,
      troughMs != null && troughMs >= startMs && troughMs <= endMs
        ? {
            key: "trough",
            ms: troughMs,
            label: "trough",
            color: tone.strength,
          }
        : null,
    ].filter(Boolean);

    return { startMs, endMs, x, segments, markers };
  }, [timeline, asset, event, tone.crimson, tone.strength]);

  if (!geometry) {
    return (
      <div className="grid h-[150px] place-items-center rounded-xl border border-dashed border-black/5 px-4 text-center text-micro text-black/60 dark:border-white/5 dark:text-white/60">
        No {asset.label} quote in this comparison window.
      </div>
    );
  }

  const { startMs, endMs, x, segments, markers } = geometry;

  return (
    <div className="overflow-hidden rounded-xl border border-black/5 bg-white/35 dark:border-white/5 dark:bg-black/20">
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${asset.label} mini chart for ${event?.name ?? "the selected event"}`}
        >
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={PAD.top + PLOT_H}
            y2={PAD.top + PLOT_H}
            stroke={tone.grid}
          />
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={PAD.top + PLOT_H / 2}
            y2={PAD.top + PLOT_H / 2}
            stroke={tone.grid}
            strokeDasharray="2 4"
          />

          {segments.map((segment, index) => (
            <path
              key={`convergence-mini-${index}`}
              d={pathFromSegment(segment)}
              fill="none"
              stroke={color}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {markers.map((marker) => (
            <line
              key={`convergence-marker-${marker.key}`}
              x1={x(marker.ms)}
              x2={x(marker.ms)}
              y1={PAD.top - 2}
              y2={PAD.top + PLOT_H}
              stroke={marker.color}
              strokeOpacity="0.55"
              strokeDasharray="2 4"
            />
          ))}
        </svg>
        {markers.length > 0 ? (
          <div
            className="pointer-events-none absolute inset-0 font-mono text-micro leading-none text-black/60 dark:text-white/60"
            aria-hidden="true"
          >
            {markers.map((marker) => {
              const markerX = x(marker.ms);
              // Centred over the line; flush to the line near either edge.
              const align =
                markerX > WIDTH * 0.9
                  ? "-translate-x-full"
                  : markerX < WIDTH * 0.1
                    ? ""
                    : "-translate-x-1/2";
              return (
                <span
                  key={`convergence-label-${marker.key}`}
                  className={`absolute top-0 whitespace-nowrap ${align}`}
                  style={{ left: pct(markerX, WIDTH) }}
                >
                  {marker.label}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
      <div
        className="flex justify-between gap-2 pb-2 font-mono text-micro text-black/70 dark:text-white/70"
        style={{
          paddingLeft: pct(PAD.left, WIDTH),
          paddingRight: pct(PAD.right, WIDTH),
        }}
        aria-hidden="true"
      >
        <span>{formatDate(startMs)}</span>
        <span>{formatDate(endMs)}</span>
      </div>
    </div>
  );
}
