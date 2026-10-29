"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDaysIso,
  buildSegments,
  clamp,
  coreIndexTone,
  formatDate,
  getChartTone,
  pathFromSegment,
} from "@/components/regime/regimeUtils";
import {
  ASSET_TARGETS,
  getAssetTarget,
} from "@/components/regime/assetTargets";

const WIDTH = 760;
const HEIGHT = 420;
const PAD = { top: 30, right: 30, bottom: 52, left: 58 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const VOL_THRESHOLD = 50;
const DRAWDOWN_THRESHOLD = -10;
const TRACE_DAYS = 90;
// Fetch a trace only once the pointer rests on a week, and keep recent traces
// so scrubbing back and forth does not refetch them.
const TRACE_DWELL_MS = 220;
const TRACE_CACHE_LIMIT = 24;
const TRACE_FIELDS = [
  "date",
  "core_index",
  "core_index_bucket",
  ...Object.values(ASSET_TARGETS).flatMap((target) => [
    target.percentileField,
    target.drawdownField,
  ]),
];
const EMPTY_TIMELINE = [];
const FOCUS_RING_INSET =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--sh-focus,rgba(240,93,73,0.55))]";

// Parsed, ready traces keyed `${start}|${asOf}`; least recently used first.
const traceCache = new Map();

function rememberTrace(key, timeline) {
  traceCache.delete(key);
  traceCache.set(key, timeline);
  while (traceCache.size > TRACE_CACHE_LIMIT) {
    traceCache.delete(traceCache.keys().next().value);
  }
}

function slimTrace(timeline) {
  return timeline.map((item) => {
    const slim = {};
    for (const field of TRACE_FIELDS) {
      if (item?.[field] != null) slim[field] = item[field];
    }
    return slim;
  });
}

const QUADRANTS = {
  calm_bullish: {
    label: "Complacency / Trim Risk",
    detail: "low volatility · shallow",
    fill: "#b45309",
    fillDark: "#fbbf24",
  },
  volatile_bullish: {
    label: "Euphoria / Distribution",
    detail: "high volatility · shallow",
    fill: "#c0442f",
    fillDark: "#fb7185",
  },
  calm_bearish: {
    label: "Despair / Base Building",
    detail: "low volatility · deep",
    fill: "#0f766e",
    fillDark: "#5eead4",
  },
  volatile_bearish: {
    label: "Panic / Accumulation Zone",
    detail: "high volatility · deep",
    fill: "#047857",
    fillDark: "#34d399",
  },
};

function Quadrant({ x, y, width, height, quadrant, isDark, strong }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={isDark ? quadrant.fillDark : quadrant.fill}
        fillOpacity={strong ? 0.17 : 0.065}
      />
      <text
        x={x + width / 2}
        y={y + height / 2 - 2}
        fill={isDark ? "rgba(242,237,228,0.78)" : "rgba(20,18,26,0.72)"}
        fontSize="10"
        textAnchor="middle"
        className="font-mono font-semibold tracking-[0.1em]"
      >
        {quadrant.label.toUpperCase()}
      </text>
      <text
        x={x + width / 2}
        y={y + height / 2 + 12}
        fill={isDark ? "rgba(242,237,228,0.6)" : "rgba(20,18,26,0.6)"}
        fontSize="10"
        textAnchor="middle"
        className="font-mono"
      >
        {quadrant.detail}
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
  const traceStart = asOf ? addDaysIso(asOf, -TRACE_DAYS) : null;
  const traceKey = traceStart ? `${traceStart}|${asOf}` : null;
  const [trace, setTrace] = useState({
    key: null,
    status: "idle",
    timeline: EMPTY_TIMELINE,
    error: null,
  });

  useEffect(() => {
    if (!traceKey) return undefined;
    if (traceCache.has(traceKey)) {
      rememberTrace(traceKey, traceCache.get(traceKey));
      return undefined;
    }
    const [start, end] = traceKey.split("|");

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `/api/v1/regime/macro-history?resolution=daily&start=${start}&end=${end}`,
        { signal: controller.signal },
      )
        .then(async (response) => {
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(
              payload?.detail ||
                payload?.error ||
                `Phase trace returned ${response.status}.`,
            );
          }
          return response.json();
        })
        .then((payload) => {
          const timeline = slimTrace(
            Array.isArray(payload?.timeline) ? payload.timeline : [],
          );
          rememberTrace(traceKey, timeline);
          setTrace({ key: traceKey, status: "ready", timeline, error: null });
        })
        .catch((error) => {
          if (error.name !== "AbortError") {
            setTrace({
              key: traceKey,
              status: "error",
              timeline: EMPTY_TIMELINE,
              error: error.message,
            });
          }
        });
    }, TRACE_DWELL_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [traceKey]);

  // A cached trace is shown at once; otherwise only the trace fetched for
  // this exact window counts, so a previous week's path never stands in.
  const cachedTimeline = traceKey ? traceCache.get(traceKey) : undefined;
  const traceStatus = cachedTimeline
    ? "ready"
    : trace.key === traceKey
      ? trace.status
      : traceKey
        ? "loading"
        : "idle";
  const traceTimeline =
    cachedTimeline ??
    (trace.key === traceKey ? trace.timeline : EMPTY_TIMELINE);

  const tracePoints = useMemo(() => {
    if (!Array.isArray(traceTimeline)) return [];
    return traceTimeline
      .map((item) => ({
        ...item,
        vol:
          item[asset.percentileField] == null
            ? Number.NaN
            : Number(item[asset.percentileField]),
        drawdown:
          item[asset.drawdownField] == null
            ? Number.NaN
            : Number(item[asset.drawdownField]),
      }))
      .filter(
        (item) =>
          Number.isFinite(item.vol) && Number.isFinite(item.drawdown),
      )
      .slice(-TRACE_DAYS);
  }, [traceTimeline, asset]);
  const traceEmpty = traceStatus === "ready" && tracePoints.length === 0;

  const passedPoint = point
    ? {
        ...point,
        vol:
          point[asset.percentileField] == null
            ? Number.NaN
            : Number(point[asset.percentileField]),
        drawdown:
          point[asset.drawdownField] == null
            ? Number.NaN
            : Number(point[asset.drawdownField]),
      }
    : null;
  const current =
    passedPoint &&
    Number.isFinite(passedPoint.vol) &&
    Number.isFinite(passedPoint.drawdown)
      ? passedPoint
      : tracePoints.at(-1) ?? null;

  const hasPoint =
    current != null &&
    Number.isFinite(current.vol) &&
    Number.isFinite(current.drawdown);
  const currentVol = hasPoint ? current.vol : Number.NaN;
  const currentDrawdown = hasPoint ? current.drawdown : Number.NaN;
  const currentQuadrant =
    !hasPoint
      ? null
      : currentVol >= VOL_THRESHOLD &&
          currentDrawdown <= DRAWDOWN_THRESHOLD
        ? "volatile_bearish"
        : currentVol >= VOL_THRESHOLD
          ? "volatile_bullish"
          : currentDrawdown <= DRAWDOWN_THRESHOLD
            ? "calm_bearish"
            : "calm_bullish";
  const toneForIndex = coreIndexTone(
    current?.core_index_bucket ?? point?.core_index_bucket,
    isDark,
  );
  const markerColor = currentQuadrant
    ? isDark
      ? QUADRANTS[currentQuadrant].fillDark
      : QUADRANTS[currentQuadrant].fill
    : toneForIndex.color;

  // Weeks without volatility data have no point and no trace; keep the scale
  // finite so the four zones always draw.
  const minDrawdown = Math.min(
    -10,
    ...[currentDrawdown, ...tracePoints.map((item) => item.drawdown)].filter(
      Number.isFinite,
    ),
  );
  const yMin = Math.min(-40, minDrawdown * 1.15);

  const x = (value) =>
    PAD.left + (clamp(value, 0, 100) / 100) * PLOT_W;
  const y = (value) =>
    PAD.top + (clamp(value, yMin, 0) / yMin) * PLOT_H;
  const thresholdY = y(DRAWDOWN_THRESHOLD);
  const thresholdX = x(VOL_THRESHOLD);
  const traceSegments = buildSegments(
    tracePoints,
    (item) => item.drawdown,
    (item) => x(item.vol),
    (value) => y(value),
  );
  const traceColor = isDark ? "#a5f3fc" : "#0e7490";

  return (
    <section
      aria-labelledby="phase-plane-title"
      className="overflow-hidden rounded-[1.6rem] border border-(--sh-line-1) bg-white/45 dark:bg-black/40"
    >
      <div className="flex flex-col gap-2 border-b border-black/5 p-5 dark:border-white/5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div className="min-w-0">
          <p className="text-micro uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
            Cycle map · {asset.label}
          </p>
          <h2
            id="phase-plane-title"
            className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4] sm:text-2xl"
          >
            The 90-day path
          </h2>
          {/* The week on one line of its own (the date in fixed-width
              numerals) and the hint below it, so scrubbing never re-wraps
              this text or moves what follows. */}
          <p className="mt-1 truncate text-micro text-black/60 dark:text-white/60">
            <span className="font-mono tabular-nums">{formatDate(asOf)}</span> ·{" "}
            {contextLabel}
          </p>
          <p className="text-micro text-black/60 dark:text-white/60">
            <span className="[@media(hover:none)]:hidden">
              Move your cursor on the chart to trace the cycle
            </span>
            <span className="hidden [@media(hover:none)]:inline">
              Press and hold the chart to scrub
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-micro text-black/60 dark:text-white/60">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: traceColor }}
            aria-hidden="true"
          />
          Glowing trace: prior {TRACE_DAYS} days
        </div>
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-label="Cycle map, scrollable"
        className={`overflow-x-auto p-2 sm:p-3 ${FOCUS_RING_INSET}`}
      >
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[560px]"
          role="img"
          aria-label={`Two by two cycle map of ${asset.label} volatility percentile versus one-year drawdown as of ${formatDate(asOf)}`}
        >
          <Quadrant
            x={PAD.left}
            y={PAD.top}
            width={PLOT_W / 2}
            height={thresholdY - PAD.top}
            quadrant={QUADRANTS.calm_bullish}
            isDark={isDark}
            strong={currentQuadrant === "calm_bullish"}
          />
          <Quadrant
            x={thresholdX}
            y={PAD.top}
            width={PLOT_W / 2}
            height={thresholdY - PAD.top}
            quadrant={QUADRANTS.volatile_bullish}
            isDark={isDark}
            strong={currentQuadrant === "volatile_bullish"}
          />
          <Quadrant
            x={PAD.left}
            y={thresholdY}
            width={PLOT_W / 2}
            height={PAD.top + PLOT_H - thresholdY}
            quadrant={QUADRANTS.calm_bearish}
            isDark={isDark}
            strong={currentQuadrant === "calm_bearish"}
          />
          <Quadrant
            x={thresholdX}
            y={thresholdY}
            width={PLOT_W / 2}
            height={PAD.top + PLOT_H - thresholdY}
            quadrant={QUADRANTS.volatile_bearish}
            isDark={isDark}
            strong={currentQuadrant === "volatile_bearish"}
          />

          <rect
            x={PAD.left}
            y={PAD.top}
            width={PLOT_W}
            height={PLOT_H}
            fill="none"
            stroke={tone.grid}
          />
          <line
            x1={thresholdX}
            x2={thresholdX}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            stroke={tone.axis}
            strokeOpacity="0.35"
            strokeDasharray="4 5"
          />
          <line
            x1={PAD.left}
            x2={PAD.left + PLOT_W}
            y1={thresholdY}
            y2={thresholdY}
            stroke={tone.axis}
            strokeOpacity="0.35"
            strokeDasharray="4 5"
          />

          <text
            x={PAD.left + PLOT_W / 2}
            y={HEIGHT - 8}
            fill={tone.axisStrong}
            fontSize="10"
            textAnchor="middle"
            className="font-mono"
          >
            CALM → VOLATILE
          </text>
          <text
            x={16}
            y={PAD.top + PLOT_H / 2}
            fill={tone.axisStrong}
            fontSize="10"
            textAnchor="middle"
            transform={`rotate(-90 16 ${PAD.top + PLOT_H / 2})`}
            className="font-mono"
          >
            SHALLOW → DEEP
          </text>

          {traceSegments.map((segment, index) => (
            <g key={`phase-trace-${index}`}>
              <path
                d={pathFromSegment(segment)}
                fill="none"
                stroke={traceColor}
                strokeWidth="7"
                strokeOpacity="0.22"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={pathFromSegment(segment)}
                fill="none"
                stroke={traceColor}
                strokeWidth="2"
                strokeOpacity="0.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}

          {tracePoints.length > 1 ? (
            <circle
              cx={x(tracePoints[0].vol)}
              cy={y(tracePoints[0].drawdown)}
              r="3"
              fill={traceColor}
              fillOpacity="0.75"
            />
          ) : null}

          {hasPoint ? (
            <g>
              <circle
                cx={x(currentVol)}
                cy={y(currentDrawdown)}
                r="5.5"
                fill={markerColor}
                stroke={isDark ? "#020204" : "#f1ebe2"}
                strokeWidth="2"
              />
              <text
                x={x(currentVol) + (currentVol > 80 ? -10 : 10)}
                y={y(currentDrawdown) - 10}
                fill={markerColor}
                fontSize="10"
                textAnchor={currentVol > 80 ? "end" : "start"}
                className="font-mono"
              >
                {formatDate(asOf)}
              </text>
            </g>
          ) : (
            <text
              x={PAD.left + PLOT_W / 2}
              y={PAD.top + PLOT_H / 2}
              fill={tone.axisText}
              fontSize="10"
              textAnchor="middle"
              className="font-mono"
            >
              {traceEmpty
                ? "No volatility data for this window"
                : "Move across the chart to load the cycle path"}
            </text>
          )}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-black/5 px-4 py-3 dark:border-white/5 sm:grid-cols-3">
        <div>
          <p className="text-micro uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
            Current
          </p>
          {/* Two lines kept below sm, where the longest zone name wraps. */}
          <p
            className="mt-0.5 min-h-[2.9em] font-mono text-meta uppercase sm:min-h-0"
            style={{ color: markerColor }}
          >
            {currentQuadrant
              ? QUADRANTS[currentQuadrant].label
              : traceEmpty
                ? "No data"
                : traceStatus === "error"
                  ? "Unavailable"
                  : "Awaiting trace"}
          </p>
        </div>
        <div>
          <p className="text-micro uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
            Core Index
          </p>
          <p
            className="mt-0.5 font-mono text-meta"
            style={{ color: toneForIndex.color }}
          >
            {current?.core_index == null
              ? "—"
              : current.core_index > 0
                ? `+${Number(current.core_index).toFixed(1)}`
                : Number(current.core_index).toFixed(1)}
          </p>
        </div>
        <div>
          <p className="text-micro uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
            Trace
          </p>
          <p className="mt-0.5 font-mono text-meta text-[#14121a] dark:text-[#f2ede4]">
            {tracePoints.length > 0
              ? `${tracePoints.length} days`
              : traceStatus === "error"
                ? "Unavailable"
                : traceStatus === "ready"
                  ? "No data"
                  : "Loading…"}
          </p>
        </div>
      </div>

      <div className="border-t border-black/5 px-4 py-3 dark:border-white/5">
        <p className="text-micro font-medium uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
          Contrarian playbook
        </p>
        {/* Two lines kept below sm for the longest allocation. */}
        <p
          className="mt-1 min-h-[3.25em] text-meta leading-relaxed sm:min-h-0"
          style={{ color: toneForIndex.color }}
        >
          {toneForIndex.allocation}
        </p>
      </div>

      <p className="border-t border-black/5 px-4 py-3 text-micro leading-relaxed text-black/60 dark:border-white/5 dark:text-white/60">
        <span className="[@media(hover:none)]:hidden">
          Hover the main chart to redraw the glowing 90-day trail.
        </span>
        <span className="hidden [@media(hover:none)]:inline">
          Press and hold the chart to scrub.
        </span>{" "}
        The quadrants
        are contrarian risk-posture zones: trim into complacency and euphoria,
        build into despair and panic. They are not personalised advice.
      </p>
    </section>
  );
}
