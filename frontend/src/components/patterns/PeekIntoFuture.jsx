"use client";

import { useMemo } from "react";
import {
  buildSegments,
  clamp,
  formatDate,
  formatPercent,
  getChartTone,
  parseIsoDay,
  pathFromSegment,
} from "@/components/regime/regimeUtils";

const WIDTH = 760;
const HEIGHT = 300;
const PAD = { top: 28, right: 24, bottom: 34, left: 42 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

const CATEGORY_COLORS = {
  Financial: "#fb7185",
  Geopolitics: "#a78bfa",
  Science: "#67e8f9",
  "Science & Technology": "#67e8f9",
};

function categoryColor(category) {
  return CATEGORY_COLORS[category] ?? "#facc15";
}

function ForwardChart({ forward, accent, isDark }) {
  const tone = useMemo(() => getChartTone(isDark), [isDark]);
  const geometry = useMemo(() => {
    if (!forward || !Array.isArray(forward.series)) return null;
    const points = forward.series
      .map((point) => ({
        ...point,
        ms: parseIsoDay(point.date),
        value: Number(point.value),
      }))
      .filter(
        (point) =>
          point.ms != null &&
          Number.isFinite(point.value) &&
          point.value > 0,
      );
    if (points.length < 2) return null;

    const startMs = points[0].ms;
    const endMs = points[points.length - 1].ms;
    const span = Math.max(1, endMs - startMs);
    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const x = (ms) =>
      PAD.left + clamp((ms - startMs) / span, 0, 1) * PLOT_W;
    const y = (value) =>
      PAD.top + PLOT_H - ((value - min) / range) * PLOT_H;
    const segments = buildSegments(
      points,
      (point) => point.value,
      (point) => x(point.ms),
      y,
    );
    const peakMs = parseIsoDay(
      forward.drawdown_peak?.date ?? forward.peak?.date,
    );
    const troughMs = parseIsoDay(forward.trough?.date);
    const baseline = PAD.top + PLOT_H;
    const area = segments
      .map((segment) => {
        if (segment.length < 2) return "";
        const firstX = segment[0][0];
        const lastX = segment[segment.length - 1][0];
        return `${segment
          .map(([sx, sy], index) => `${index === 0 ? "M" : "L"}${sx},${sy}`)
          .join(" ")} L${lastX},${baseline} L${firstX},${baseline} Z`;
      })
      .join(" ");
    return {
      points,
      startMs,
      endMs,
      x,
      y,
      segments,
      area,
      peakMs,
      troughMs,
    };
  }, [forward]);

  if (!geometry) {
    return (
      <div className="grid h-[250px] place-items-center rounded-2xl border border-dashed border-black/5 text-micro text-black/35 dark:border-white/5 dark:text-white/35">
        Forward tape unavailable for this asset.
      </div>
    );
  }

  const {
    startMs,
    endMs,
    x,
    y,
    segments,
    area,
    peakMs,
    troughMs,
  } = geometry;
  const peakPoint =
    peakMs == null
      ? null
      : {
          ms: peakMs,
          value: Number(
            forward.drawdown_peak?.value ?? forward.peak?.value,
          ),
        };
  const troughPoint =
    troughMs == null
      ? null
      : { ms: troughMs, value: Number(forward.trough?.value) };

  return (
    <div className="overflow-hidden rounded-2xl border border-black/5 bg-black/[0.02] p-2 dark:border-white/5 dark:bg-black/25 sm:p-3">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Historical one-year forward price path for ${forward.asset}, ${formatDate(forward.start)} to ${formatDate(forward.end)}`}
      >
        <defs>
          <linearGradient id="peek-forward-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.24" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={PAD.top + PLOT_H}
          y2={PAD.top + PLOT_H}
          stroke={tone.grid}
        />
        <path d={area} fill="url(#peek-forward-fill)" />
        {segments.map((segment, index) => (
          <path
            key={`peek-forward-line-${index}`}
            d={pathFromSegment(segment)}
            fill="none"
            stroke={accent}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {peakPoint ? (
          <g>
            <line
              x1={x(peakPoint.ms)}
              x2={x(peakPoint.ms)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke="#fb7185"
              strokeOpacity="0.45"
              strokeDasharray="3 4"
            />
            <circle
              cx={x(peakPoint.ms)}
              cy={y(peakPoint.value)}
              r="4"
              fill="#fb7185"
              stroke={isDark ? "#08080c" : "#f6f1e9"}
              strokeWidth="2"
            />
            <text
              x={x(peakPoint.ms) + 7}
              y={y(peakPoint.value) - 8}
              fill="#fb7185"
              fontSize="9"
              className="font-mono"
            >
              PEAK
            </text>
          </g>
        ) : null}

        {troughPoint ? (
          <g>
            <line
              x1={x(troughPoint.ms)}
              x2={x(troughPoint.ms)}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              stroke="#fb7185"
              strokeOpacity="0.5"
              strokeDasharray="3 4"
            />
            <circle
              cx={x(troughPoint.ms)}
              cy={y(troughPoint.value)}
              r="4.5"
              fill="#fb7185"
              stroke={isDark ? "#08080c" : "#f6f1e9"}
              strokeWidth="2"
            />
            <text
              x={x(troughPoint.ms) - 8}
              y={y(troughPoint.value) + 15}
              fill="#fb7185"
              fontSize="9"
              textAnchor="end"
              className="font-mono"
            >
              {formatPercent(forward.max_drawdown_pct, 1)} DRAWDOWN
            </text>
          </g>
        ) : null}

        <text
          x={PAD.left}
          y={HEIGHT - 8}
          fill={tone.axisStrong}
          fontSize="8"
          className="font-mono"
        >
          {formatDate(startMs)}
        </text>
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 8}
          fill={tone.axisStrong}
          fontSize="8"
          textAnchor="end"
          className="font-mono"
        >
          {formatDate(endMs)}
        </text>
      </svg>
    </div>
  );
}

export function PeekIntoFuture({ forward, assetLabel, isDark, accent }) {
  const events = Array.isArray(forward?.events) ? forward.events : [];
  return (
    <section
      aria-labelledby="peek-future-title"
      className="mt-5 overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/45 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-xl dark:border-white/5 dark:bg-black/40 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
    >
      <div className="border-b border-black/5 p-5 dark:border-white/5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-micro uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
              Forward echo · {forward?.start} → {forward?.end}
            </p>
            <h2
              id="peek-future-title"
              className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl"
            >
              A Peek Into The Future: What Happened Next?
            </h2>
            <p className="mt-2 max-w-2xl text-meta leading-relaxed text-black/50 dark:text-white/50">
              The exact year that followed the historical setup, shown through
              the same asset lens. These are historical events, not predictions
              for today.
            </p>
          </div>
          <span className="rounded-full border border-black/5 bg-black/[0.03] px-3 py-1.5 font-mono text-micro text-black/45 dark:border-white/5 dark:bg-white/[0.04] dark:text-white/45">
            {assetLabel}
          </span>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.25fr_0.75fr]">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/40 dark:text-white/40">
              The market echo
            </p>
            <div className="flex flex-wrap items-baseline gap-3 text-micro">
              <span className="text-black/40 dark:text-white/40">
                Forward return{" "}
                <strong className="font-mono text-black/70 dark:text-white/70">
                  {formatPercent(forward?.return_pct, 1)}
                </strong>
              </span>
              <span className="text-[#c0442f] dark:text-[#ff8b77]">
                Max drawdown{" "}
                <strong className="font-mono">
                  {formatPercent(forward?.max_drawdown_pct, 1)}
                </strong>
              </span>
            </div>
          </div>

          <div className="mt-3">
            <ForwardChart forward={forward} accent={accent} isDark={isDark} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-2 dark:border-white/5 dark:bg-white/[0.03]">
              <p className="text-[10px] uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
                Drawdown peak
              </p>
              <p className="mt-0.5 font-mono text-micro text-[#14121a] dark:text-[#f2ede4]">
                {forward?.drawdown_peak?.date
                  ? formatDate(forward.drawdown_peak.date)
                  : "—"}{" "}
                · {forward?.drawdown_peak?.value ?? "—"}
              </p>
            </div>
            <div className="rounded-xl border border-[#ef4444]/15 bg-[#ef4444]/[0.035] px-3 py-2 dark:border-[#fb7185]/15 dark:bg-[#fb7185]/[0.055]">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[#c0442f]/70 dark:text-[#ff8b77]/70">
                Peak-to-trough
              </p>
              <p className="mt-0.5 font-mono text-micro text-[#c0442f] dark:text-[#ff8b77]">
                {formatPercent(forward?.max_drawdown_pct, 1)}
              </p>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/40 dark:text-white/40">
              The event echo
            </p>
            <span className="font-mono text-[10px] text-black/30 dark:text-white/30">
              {events.length} moments
            </span>
          </div>

          <div className="relative mt-3 border-l border-black/10 pl-4 dark:border-white/10">
            {events.length > 0 ? (
              events.map((event) => {
                const color = categoryColor(event.category);
                return (
                  <article
                    key={`${event.date}-${event.title}`}
                    className="relative pb-4 last:pb-0"
                  >
                    <span
                      className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#f5f0e8] dark:border-[#07070b]"
                      style={{ backgroundColor: color }}
                      aria-hidden="true"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] text-black/35 dark:text-white/35">
                        {formatDate(event.date)}
                      </span>
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em]"
                        style={{
                          color,
                          backgroundColor: `${color}16`,
                        }}
                      >
                        {event.category}
                      </span>
                    </div>
                    <h3 className="mt-1 text-meta font-semibold leading-snug text-[#14121a] dark:text-[#f2ede4]">
                      {event.title}
                    </h3>
                    <p className="mt-1 text-micro leading-relaxed text-black/45 dark:text-white/45">
                      {event.summary}
                    </p>
                  </article>
                );
              })
            ) : (
              <p className="text-micro leading-relaxed text-black/40 dark:text-white/40">
                No curated event archive for this historical window yet.
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="border-t border-black/5 px-5 py-3 text-[10px] leading-relaxed text-black/35 dark:border-white/5 dark:text-white/35 sm:px-6">
        This is a historical echo of what followed a similar market setup. It
        is descriptive research, not a forecast or investment advice.
      </p>
    </section>
  );
}
