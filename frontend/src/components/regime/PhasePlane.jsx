"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDaysIso,
  clamp,
  formatDate,
  formatPercent,
  getChartTone,
  parseIsoDay,
} from "@/components/regime/regimeUtils";
import {
  getRegimeToneColor,
  getRegimeToneLabel,
} from "@/lib/regimeTone";

const WIDTH = 760;
const HEIGHT = 390;
const PAD = { top: 30, right: 34, bottom: 48, left: 58 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;
const X_TICKS = [0, 25, 50, 75, 100];
const VOL_THRESHOLD = 50;
const DRAWDOWN_THRESHOLD = -10;

function pathFromPoints(points, x, y) {
  if (points.length === 0) return "";
  return points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${x(point.vol).toFixed(2)},${y(point.drawdown).toFixed(2)}`;
    })
    .join(" ");
}

export function PhasePlane({ asOf, contextLabel, isDark }) {
  const tone = useMemo(() => getChartTone(isDark), [isDark]);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({
    status: "loading",
    timeline: null,
    error: null,
  });

  useEffect(() => {
    if (!asOf) return undefined;
    const start = addDaysIso(asOf, -120);
    if (!start) return undefined;

    const controller = new AbortController();
    fetch(
      `/api/v1/regime/macro-history?resolution=daily&start=${start}&end=${asOf}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const error = new Error(
            payload?.detail ||
              `Phase-plane window returned ${response.status}.`,
          );
          error.status = response.status;
          throw error;
        }
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload?.timeline)) {
          throw new Error("The phase-plane window returned an unexpected payload.");
        }
        setState({
          status: "ready",
          timeline: payload.timeline,
          error: null,
        });
      })
      .catch((loadError) => {
        if (loadError.name === "AbortError") return;
        setState({
          status: "error",
          timeline: null,
          error: loadError.message,
        });
      });

    return () => controller.abort();
  }, [asOf, reloadKey]);

  const analytics = useMemo(() => {
    if (state.status !== "ready" || !Array.isArray(state.timeline)) {
      return null;
    }

    const points = state.timeline
      .map((point) => {
        const ms = parseIsoDay(point.date);
        const vol =
          point["1y_volatility_percentile"] == null
            ? Number.NaN
            : Number(point["1y_volatility_percentile"]);
        const drawdown =
          point.drawdown_1y == null
            ? Number.NaN
            : Number(point.drawdown_1y);
        return {
          ...point,
          ms,
          vol,
          drawdown,
        };
      })
      .filter(
        (point) =>
          point.ms != null &&
          Number.isFinite(point.vol) &&
          Number.isFinite(point.drawdown),
      );

    if (points.length === 0) return null;

    const path = points.slice(-90);
    const current = path[path.length - 1];
    const minDrawdown = Math.min(
      DRAWDOWN_THRESHOLD,
      ...path.map((point) => point.drawdown),
    );
    // Keep a meaningful 0 to -40% plane even in calm periods; expand further
    // only when the 90-day path contains a deeper drawdown.
    const yMin = Math.min(-40, minDrawdown * 1.15);
    const yTicks = [];
    const tickFloor = Math.ceil(yMin / 10) * 10;
    for (let value = 0; value >= tickFloor; value -= 10) {
      yTicks.push(value);
    }

    return { path, current, yMin, yTicks };
  }, [state]);

  const handleRetry = () => {
    setState({ status: "loading", timeline: null, error: null });
    setReloadKey((key) => key + 1);
  };

  return (
    <section
      aria-labelledby="phase-plane-title"
      className="overflow-hidden rounded-[1.6rem] border border-black/10 bg-white/60 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-black/40 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
    >
      <div className="border-b border-black/[0.07] p-5 dark:border-white/10 sm:p-6">
        <p className="text-micro uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
          Phase plane
        </p>
        <h2
          id="phase-plane-title"
          className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4] sm:text-2xl"
        >
          Volatility vs drawdown
        </h2>
        <p className="mt-1 text-micro text-black/45 dark:text-white/45">
          {formatDate(asOf)} · {contextLabel} · trailing 90 daily observations
        </p>
      </div>

      {state.status === "loading" ? (
        <div className="p-5 sm:p-6">
          <div className="h-[260px] animate-pulse rounded-2xl bg-black/[0.04] dark:bg-white/[0.05]" />
          <p className="mt-3 text-micro text-black/40 dark:text-white/40">
            Reading the serialized phase features…
          </p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="p-5 sm:p-6">
          <div className="rounded-2xl border border-[#ef4444]/25 bg-[#ef4444]/[0.04] p-4">
            <p className="text-meta font-medium text-[#c0442f] dark:text-[#ff8b77]">
              Phase plane unavailable
            </p>
            <p className="mt-1 text-micro text-black/45 dark:text-white/45">
              {state.error}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-3 rounded-full border border-black/10 px-3 py-1.5 text-micro font-medium text-black/60 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-white/60 dark:hover:bg-white/[0.06]"
            >
              Retry phase window
            </button>
          </div>
        </div>
      ) : null}

      {state.status === "ready" && !analytics ? (
        <div className="p-5 sm:p-6">
          <p className="rounded-2xl border border-black/10 bg-black/[0.02] p-4 text-micro text-black/45 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/45">
            No phase-plane observations for this date. The equity proxy begins
            in 1871; earlier selections have no volatility percentile.
          </p>
        </div>
      ) : null}

      {state.status === "ready" && analytics ? (
        <>
          <div className="overflow-x-auto p-2 sm:p-3">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-auto w-full min-w-[560px]"
              role="img"
              aria-label={`Phase plane of one-year volatility percentile versus one-year drawdown as of ${formatDate(asOf)}`}
            >
              <defs>
                <linearGradient
                  id="phase-plane-path"
                  x1="0"
                  y1="0"
                  x2="1"
                  y2="0"
                >
                  <stop
                    offset="0%"
                    stopColor={tone.equity}
                    stopOpacity="0.2"
                  />
                  <stop
                    offset="100%"
                    stopColor={tone.equity}
                    stopOpacity="1"
                  />
                </linearGradient>
              </defs>

              <rect
                x={PAD.left}
                y={PAD.top}
                width={PLOT_W * 0.5}
                height={
                  PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin)
                }
                fill={tone.strength}
                fillOpacity="0.055"
              />
              <rect
                x={PAD.left + PLOT_W * 0.5}
                y={PAD.top}
                width={PLOT_W * 0.5}
                height={
                  PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin)
                }
                fill={tone.equity}
                fillOpacity="0.055"
              />
              <rect
                x={PAD.left}
                y={
                  PAD.top +
                  PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin)
                }
                width={PLOT_W * 0.5}
                height={
                  PLOT_H -
                  PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin)
                }
                fill={tone.equity}
                fillOpacity="0.035"
              />
              <rect
                x={PAD.left + PLOT_W * 0.5}
                y={
                  PAD.top +
                  PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin)
                }
                width={PLOT_W * 0.5}
                height={
                  PLOT_H -
                  PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin)
                }
                fill={tone.crimson}
                fillOpacity="0.06"
              />

              {X_TICKS.map((tick) => {
                const x = PAD.left + (tick / 100) * PLOT_W;
                return (
                  <g key={`phase-x-${tick}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={PAD.top}
                      y2={PAD.top + PLOT_H}
                      stroke={tone.grid}
                    />
                    <text
                      x={x}
                      y={HEIGHT - 24}
                      fill={tone.axis}
                      fontSize="9"
                      textAnchor="middle"
                      className="font-mono"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}

              {analytics.yTicks.map((tick) => {
                const y =
                  PAD.top + (tick / analytics.yMin) * PLOT_H;
                return (
                  <g key={`phase-y-${tick}`}>
                    <line
                      x1={PAD.left}
                      x2={PAD.left + PLOT_W}
                      y1={y}
                      y2={y}
                      stroke={tone.grid}
                      strokeDasharray={
                        tick === DRAWDOWN_THRESHOLD ? "3 4" : undefined
                      }
                    />
                    <text
                      x={PAD.left - 8}
                      y={y + 3}
                      fill={tone.axis}
                      fontSize="9"
                      textAnchor="end"
                      className="font-mono"
                    >
                      {tick}%
                    </text>
                  </g>
                );
              })}

              <text
                x={PAD.left + PLOT_W / 2}
                y={HEIGHT - 7}
                fill={tone.axisStrong}
                fontSize="9"
                textAnchor="middle"
                className="font-mono"
              >
                1Y VOL PERCENTILE →
              </text>
              <text
                x={15}
                y={PAD.top + PLOT_H / 2}
                fill={tone.axisStrong}
                fontSize="9"
                textAnchor="middle"
                transform={`rotate(-90 15 ${PAD.top + PLOT_H / 2})`}
                className="font-mono"
              >
                DRAWDOWN FROM 1Y HIGH ↓
              </text>

              <line
                x1={PAD.left + (VOL_THRESHOLD / 100) * PLOT_W}
                x2={PAD.left + (VOL_THRESHOLD / 100) * PLOT_W}
                y1={PAD.top}
                y2={PAD.top + PLOT_H}
                stroke={tone.axis}
                strokeOpacity="0.25"
                strokeDasharray="2 4"
              />
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT_W}
                y1={PAD.top + (DRAWDOWN_THRESHOLD / analytics.yMin) * PLOT_H}
                y2={PAD.top + (DRAWDOWN_THRESHOLD / analytics.yMin) * PLOT_H}
                stroke={tone.axis}
                strokeOpacity="0.25"
                strokeDasharray="2 4"
              />

              <text
                x={PAD.left + PLOT_W * 0.25}
                y={
                  PAD.top +
                  (PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin)) / 2 +
                  3
                }
                fill={tone.axisStrong}
                fontSize="9"
                textAnchor="middle"
                className="font-mono"
              >
                CALM
              </text>
              <text
                x={PAD.left + PLOT_W * 0.75}
                y={
                  PAD.top +
                  (PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin)) / 2 +
                  3
                }
                fill={tone.axisStrong}
                fontSize="9"
                textAnchor="middle"
                className="font-mono"
              >
                CHOPPY
              </text>
              <text
                x={PAD.left + PLOT_W * 0.25}
                y={
                  PAD.top +
                  PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin) +
                  (PLOT_H -
                    PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin)) /
                    2 +
                  3
                }
                fill={tone.axisStrong}
                fontSize="9"
                textAnchor="middle"
                className="font-mono"
              >
                GRIND
              </text>
              <text
                x={PAD.left + PLOT_W * 0.75}
                y={
                  PAD.top +
                  PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin) +
                  (PLOT_H -
                    PLOT_H * (DRAWDOWN_THRESHOLD / analytics.yMin)) /
                    2 +
                  3
                }
                fill={tone.crimson}
                fontSize="9"
                textAnchor="middle"
                className="font-mono"
              >
                CRISIS
              </text>

              <path
                d={pathFromPoints(
                  analytics.path,
                  (value) =>
                    PAD.left + (clamp(value, 0, 100) / 100) * PLOT_W,
                  (value) =>
                    PAD.top +
                    (clamp(value, analytics.yMin, 0) / analytics.yMin) *
                      PLOT_H,
                )}
                fill="none"
                stroke="url(#phase-plane-path)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {analytics.path.length > 1 ? (
                <circle
                  cx={
                    PAD.left +
                    (clamp(analytics.path[0].vol, 0, 100) / 100) * PLOT_W
                  }
                  cy={
                    PAD.top +
                    (clamp(analytics.path[0].drawdown, analytics.yMin, 0) /
                      analytics.yMin) *
                      PLOT_H
                  }
                  r="2.5"
                  fill={tone.axis}
                />
              ) : null}

              <circle
                cx={
                  PAD.left +
                  (clamp(analytics.current.vol, 0, 100) / 100) * PLOT_W
                }
                cy={
                  PAD.top +
                  (clamp(analytics.current.drawdown, analytics.yMin, 0) /
                    analytics.yMin) *
                    PLOT_H
                }
                r="5"
                fill={
                  getRegimeToneColor(analytics.current.regime_state, isDark) ??
                  tone.crimson
                }
                stroke={isDark ? "#020204" : "#f1ebe2"}
                strokeWidth="2"
              />
            </svg>
          </div>

          <div className="grid grid-cols-3 gap-2 border-t border-black/[0.07] px-4 py-3 dark:border-white/10">
            <div>
              <p className="text-micro uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
                Vol
              </p>
              <p className="mt-0.5 font-mono text-meta text-[#14121a] dark:text-[#f2ede4]">
                {Math.round(analytics.current.vol)}th pct
              </p>
            </div>
            <div>
              <p className="text-micro uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
                Drawdown
              </p>
              <p className="mt-0.5 font-mono text-meta text-[#14121a] dark:text-[#f2ede4]">
                {formatPercent(analytics.current.drawdown, 1)}
              </p>
            </div>
            <div>
              <p className="text-micro uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
                State
              </p>
              <p
                className="mt-0.5 font-mono text-meta"
                style={{
                  color:
                    getRegimeToneColor(
                      analytics.current.regime_state,
                      isDark,
                    ) ?? tone.axisStrong,
                }}
              >
                {getRegimeToneLabel(analytics.current.regime_state) ?? "—"}
              </p>
            </div>
          </div>

          <p className="border-t border-black/[0.07] px-4 py-3 text-micro leading-relaxed text-black/40 dark:border-white/10 dark:text-white/40">
            1y volatility percentile and drawdown are read directly from the
            serialized FRED artifact. The browser only maps the last 90 daily
            observations into SVG coordinates. Pre-1971 proxy history is
            monthly and forward-filled, so old phase planes are coarse.
          </p>
        </>
      ) : null}
    </section>
  );
}
