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

const WIDTH = 520;
const HEIGHT = 118;
const PAD = { top: 12, right: 8, bottom: 24, left: 8 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

export function PatternSparkline({ timeline, color, isDark }) {
  const tone = useMemo(() => getChartTone(isDark), [isDark]);

  const geometry = useMemo(() => {
    if (!Array.isArray(timeline) || timeline.length === 0) return null;
    const points = timeline
      .map((point) => ({
        ...point,
        ms: parseIsoDay(point.date),
        value: Number(point.sp500_proxy),
      }))
      .filter(
        (point) =>
          point.ms != null &&
          Number.isFinite(point.value) &&
          point.value > 0,
      );
    if (points.length < 2) return null;

    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    const startMs = points[0].ms;
    const endMs = points[points.length - 1].ms;
    const timeSpan = Math.max(1, endMs - startMs);
    const x = (ms) =>
      PAD.left + clamp((ms - startMs) / timeSpan, 0, 1) * PLOT_W;
    const y = (value) =>
      PAD.top + PLOT_H - ((value - min) / span) * PLOT_H;
    return {
      segments: buildSegments(
        points,
        (point) => point.value,
        (point) => x(point.ms),
        y,
      ),
      startMs,
      endMs,
    };
  }, [timeline]);

  if (!geometry) {
    return (
      <div className="grid h-[112px] place-items-center rounded-xl border border-dashed border-black/5 text-micro text-black/35 dark:border-white/5 dark:text-white/35">
        Market tape unavailable
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Market path from ${formatDate(geometry.startMs)} to ${formatDate(geometry.endMs)}`}
    >
      <line
        x1={PAD.left}
        x2={WIDTH - PAD.right}
        y1={PAD.top + PLOT_H}
        y2={PAD.top + PLOT_H}
        stroke={tone.grid}
      />
      {geometry.segments.map((segment, index) => (
        <path
          key={`pattern-spark-${index}`}
          d={pathFromSegment(segment)}
          fill="none"
          stroke={color}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      <text
        x={PAD.left}
        y={HEIGHT - 7}
        fill={tone.axis}
        fontSize="8"
        className="font-mono"
      >
        {formatDate(geometry.startMs)}
      </text>
      <text
        x={WIDTH - PAD.right}
        y={HEIGHT - 7}
        fill={tone.axis}
        fontSize="8"
        textAnchor="end"
        className="font-mono"
      >
        {formatDate(geometry.endMs)}
      </text>
    </svg>
  );
}
