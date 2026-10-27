"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
} from "lightweight-charts";
import { ChartCrosshairLegend } from "@/components/regime/ChartCrosshairLegend";
import { MacroHUD } from "@/components/regime/MacroHUD";
import {
  ASSET_ORDER,
  ASSET_TARGETS,
  assetChartColor,
  assetChartSoft,
  getAssetTarget,
} from "@/components/regime/assetTargets";
import {
  coreIndexTone,
  formatDate,
  formatPercent,
  formatSigned,
  getChartTone,
} from "@/components/regime/regimeUtils";

function lowerBoundByDate(points, date) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].date < date) low = middle + 1;
    else high = middle;
  }
  return low;
}

function pointAtOrAfter(points, date) {
  if (!Array.isArray(points) || points.length === 0 || !date) return null;
  const index = lowerBoundByDate(points, date);
  return points[index] ?? null;
}

function buildBands(timeline, crashes) {
  if (!Array.isArray(timeline) || timeline.length === 0) return [];

  return (crashes ?? [])
    .map((crash) => {
      const startIndex = lowerBoundByDate(timeline, crash.start);
      let endIndex = lowerBoundByDate(timeline, crash.end);
      if (endIndex >= timeline.length || timeline[endIndex].date > crash.end) {
        endIndex -= 1;
      }
      if (startIndex >= timeline.length || endIndex < startIndex) return null;

      return {
        id: crash.id,
        start: timeline[startIndex].date,
        end: timeline[endIndex].date,
      };
    })
    .filter(Boolean);
}

function buildCrashMetrics(timeline, crashes) {
  return (crashes ?? []).map((crash) => {
    const points = timeline.filter(
      (point) => point.date >= crash.start && point.date <= crash.end,
    );
    const equities = points
      .map((point) => Number(point.sp500_proxy))
      .filter((value) => Number.isFinite(value) && value > 0);
    const peak = equities.length ? Math.max(...equities) : null;
    const trough = equities.length ? Math.min(...equities) : null;
    const drawdown =
      peak != null && trough != null && peak > 0
        ? (trough / peak - 1) * 100
        : null;
    const scores = points
      .map((point) => Number(point.core_index))
      .filter((value) => Number.isFinite(value));
    return {
      id: crash.id,
      name: crash.name,
      start: crash.start,
      end: crash.end,
      drawdown,
      score: scores.length ? Math.min(...scores) : null,
    };
  });
}

function applyCrashZoom(chart, crash) {
  if (!chart || !crash) return;
  const from = crash.start;
  const to = crash.end;
  if (!from || !to) return;

  try {
    chart.timeScale().setVisibleRange({ from, to });
  } catch {
    // The library clamps ranges that fall outside the loaded time scale.
  }
}

function buildChartSeries(timeline, target) {
  if (target.key !== "sp500") {
    return timeline
      .map((point) => ({
        time: point.date,
        value: Number(point[target.valueField]),
      }))
      .filter(
        (point) => Number.isFinite(point.value) && point.value > 0,
      );
  }

  const output = [];
  let level = null;
  let previous = null;
  let previousSource = null;
  for (const point of timeline) {
    const raw = Number(point[target.valueField]);
    if (!Number.isFinite(raw) || raw <= 0) {
      previous = null;
      previousSource = null;
      continue;
    }
    const source = point[target.sourceField] ?? null;
    if (level == null) {
      level = raw;
    } else if (source === previousSource && previous != null) {
      level *= raw / previous;
    }
    output.push({ time: point.date, value: level });
    previous = raw;
    previousSource = source;
  }
  return output;
}

function createRecessionBandsPrimitive(bands, initialSelectedId) {
  const renderer = {
    draw: (target) => {
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        const timeScale = primitive.chart?.timeScale();
        if (!timeScale) return;

        for (const band of bands) {
          const first = timeScale.timeToCoordinate(band.start);
          const last = timeScale.timeToCoordinate(band.end);
          if (first == null || last == null) continue;

          const left = Math.max(0, Math.min(first, last));
          const right = Math.min(mediaSize.width, Math.max(first, last));
          if (right <= left) continue;

          const selected = band.id === primitive.selectedId;
          const hovered = band.id === primitive.hoveredId;
          context.fillStyle = selected
            ? "rgba(239, 68, 68, 0.22)"
            : hovered
              ? "rgba(239, 68, 68, 0.16)"
              : "rgba(239, 68, 68, 0.075)";
          context.fillRect(left, 0, right - left, mediaSize.height);
        }
      });
    },
  };
  const view = {
    zOrder: () => "bottom",
    renderer: () => renderer,
  };
  const views = [view];

  const primitive = {
    selectedId: initialSelectedId ?? null,
    hoveredId: null,
    requestUpdate: () => {},
    unsubscribe: null,
    view,
    attached({ chart, requestUpdate }) {
      primitive.chart = chart;
      primitive.requestUpdate = requestUpdate;
      const timeScale = chart.timeScale();
      const handleRange = () => requestUpdate();
      timeScale.subscribeVisibleLogicalRangeChange(handleRange);
      primitive.unsubscribe = () =>
        timeScale.unsubscribeVisibleLogicalRangeChange(handleRange);
    },
    detached() {
      primitive.unsubscribe?.();
      primitive.unsubscribe = null;
      primitive.chart = null;
      primitive.requestUpdate = () => {};
    },
    updateAllViews() {},
    paneViews() {
      return views;
    },
  };

  return primitive;
}

function createCoreIndexHistogramPrimitive(points, isDark) {
  const renderer = {
    draw: (target) => {
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        const timeScale = primitive.chart?.timeScale();
        if (!timeScale || !Array.isArray(points) || points.length === 0) {
          return;
        }
        const top = mediaSize.height * 0.71;
        const plotHeight = mediaSize.height * 0.26;
        const zeroY = top + plotHeight / 2;
        const half = plotHeight / 2;
        const barWidth = Math.max(
          1,
          Math.min(3, (timeScale.options()?.barSpacing ?? 1) * 0.55),
        );

        for (const point of points) {
          if (!Number.isFinite(Number(point.value))) continue;
          const x = timeScale.timeToCoordinate(point.time);
          if (x == null) continue;
          const value = Math.max(-50, Math.min(50, Number(point.value)));
          const y = zeroY - (value / 50) * half;
          const height = Math.max(1, Math.abs(zeroY - y));
          context.fillStyle = point.color;
          context.fillRect(
            x - barWidth / 2,
            Math.min(y, zeroY),
            barWidth,
            height,
          );
        }

        const line = isDark
          ? "rgba(242, 237, 228, 0.28)"
          : "rgba(20, 18, 26, 0.24)";
        context.strokeStyle = line;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(0, zeroY);
        context.lineTo(mediaSize.width, zeroY);
        context.stroke();
        context.strokeStyle = isDark
          ? "rgba(242, 237, 228, 0.10)"
          : "rgba(20, 18, 26, 0.08)";
        context.setLineDash([3, 4]);
        for (const value of [-25, 25]) {
          const y = zeroY - (value / 50) * half;
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(mediaSize.width, y);
          context.stroke();
        }
        context.setLineDash([]);
      });
    },
  };
  const view = {
    zOrder: () => "top",
    renderer: () => renderer,
  };
  const views = [view];
  const primitive = {
    requestUpdate: () => {},
    unsubscribe: null,
    view,
    attached({ chart, requestUpdate }) {
      primitive.chart = chart;
      primitive.requestUpdate = requestUpdate;
      const timeScale = chart.timeScale();
      const handleRange = () => requestUpdate();
      timeScale.subscribeVisibleLogicalRangeChange(handleRange);
      primitive.unsubscribe = () =>
        timeScale.unsubscribeVisibleLogicalRangeChange(handleRange);
    },
    detached() {
      primitive.unsubscribe?.();
      primitive.unsubscribe = null;
      primitive.chart = null;
      primitive.requestUpdate = () => {};
    },
    updateAllViews() {},
    paneViews() {
      return views;
    },
  };
  return primitive;
}

export function RegimeTimeline({
  timeline,
  crashes,
  selectedId,
  onSelect,
  isDark,
  coverage,
  resolution,
  assetKey = "sp500",
  onAssetChange,
  compareAssets = false,
  onCompareToggle,
  onHoverPoint,
}) {
  const containerRef = useRef(null);
  const onHoverPointRef = useRef(onHoverPoint);
  const chartRef = useRef(null);
  const primitiveRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [hoveredCrashId, setHoveredCrashId] = useState(null);
  const [equityScaleWidth, setEquityScaleWidth] = useState(0);
  const [timeScaleHeight, setTimeScaleHeight] = useState(26);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    onHoverPointRef.current = onHoverPoint;
  }, [onHoverPoint]);

  const tone = useMemo(() => getChartTone(isDark), [isDark]);
  const asset = useMemo(() => getAssetTarget(assetKey), [assetKey]);
  const latestPoint = timeline.at(-1) ?? null;
  const selectedCrash = useMemo(
    () => (crashes ?? []).find((crash) => crash.id === selectedId) ?? null,
    [crashes, selectedId],
  );
  const selectedPoint = useMemo(
    () =>
      selectedCrash
        ? pointAtOrAfter(timeline, selectedCrash.start)
        : null,
    [selectedCrash, timeline],
  );
  const displayPoint = hoveredPoint ?? selectedPoint ?? latestPoint;

  const seriesKeys = useMemo(
    () => (compareAssets ? ASSET_ORDER : [assetKey]),
    [compareAssets, assetKey],
  );

  const bands = useMemo(
    () => buildBands(timeline, crashes),
    [timeline, crashes],
  );

  const crashMetrics = useMemo(
    () => buildCrashMetrics(timeline, crashes),
    [timeline, crashes],
  );

  const hoveredMetric = useMemo(
    () => crashMetrics.find((metric) => metric.id === hoveredCrashId) ?? null,
    [crashMetrics, hoveredCrashId],
  );

  const coreIndexData = useMemo(
    () =>
      timeline
        .filter(
        (point) =>
          point.core_index != null &&
          Number.isFinite(Number(point.core_index)),
      )
        .map((point) => ({
          time: point.date,
          value: Number(point.core_index),
          color: coreIndexTone(point.core_index_bucket, isDark).color,
        })),
    [timeline, isDark],
  );

  const baseDate = useMemo(
    () =>
      timeline.find(
        (point) =>
          point.core_index != null &&
          Number.isFinite(Number(point.core_index)),
      )?.date ?? timeline[0]?.date,
    [timeline],
  );

  const seriesData = useMemo(() => {
    const output = {};
    for (const key of seriesKeys) {
      const target = ASSET_TARGETS[key] ?? ASSET_TARGETS.sp500;
      const valid = buildChartSeries(timeline, target);
      const basePoint =
        valid.find((point) => point.time >= baseDate) ?? valid[0];
      const base = basePoint?.value;
      output[key] = Number.isFinite(base)
        ? valid.map((point) => ({
            time: point.time,
            value: (point.value / base) * 100,
          }))
        : [];
    }
    return output;
  }, [timeline, seriesKeys, baseDate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || timeline.length === 0) return undefined;

    setHoveredPoint(null);
    setHoveredCrashId(null);

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: tone.axis,
        fontFamily: '"Onest", ui-sans-serif, system-ui, sans-serif',
        fontSize: 10,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      localization: {
        priceFormatter: (price) =>
          `${(Number(price) - 100).toFixed(0)}%`,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: isDark
            ? "rgba(255, 139, 119, 0.55)"
            : "rgba(192, 68, 47, 0.45)",
          width: 1,
          style: LineStyle.Dotted,
          labelBackgroundColor: isDark ? "#24222b" : "#e8e0d4",
        },
        horzLine: {
          color: isDark
            ? "rgba(242, 237, 228, 0.16)"
            : "rgba(20, 18, 26, 0.12)",
          width: 1,
          style: LineStyle.Dotted,
          labelBackgroundColor: isDark ? "#24222b" : "#e8e0d4",
        },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        mode: PriceScaleMode.Logarithmic,
        scaleMargins: { top: 0.07, bottom: 0.32 },
        entireTextOnly: true,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        secondsVisible: false,
        minBarSpacing: 0.01,
        rightOffset: 1,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });
    chartRef.current = chart;

    for (const key of seriesKeys) {
      const target = ASSET_TARGETS[key] ?? ASSET_TARGETS.sp500;
      const color = assetChartColor(target, isDark);
      const selected = key === assetKey;
      const lineWidth = compareAssets ? (selected ? 2.4 : 1.7) : 2.2;

      if (selected) {
        const glow = chart.addSeries(LineSeries, {
          color: assetChartSoft(target, isDark),
          lineWidth: 5,
          priceScaleId: "right",
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        glow.setData(seriesData[key] ?? []);
      }

      const line = chart.addSeries(LineSeries, {
        color,
        lineWidth,
        priceScaleId: "right",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3.5,
        crosshairMarkerBorderColor: isDark ? "#08080c" : "#f6f1e9",
        crosshairMarkerBackgroundColor: color,
      });
      line.setData(seriesData[key] ?? []);
    }

    chart.priceScale("right").applyOptions({
      visible: true,
      borderVisible: false,
      mode: PriceScaleMode.Logarithmic,
      scaleMargins: { top: 0.07, bottom: 0.32 },
      entireTextOnly: true,
    });

    const viewportWidth = container.clientWidth || 1200;
    const targetYears = viewportWidth < 640 ? 12 : 30;
    chart.timeScale().applyOptions({
      barSpacing: Math.max(0.02, viewportWidth / (52 * targetYears)),
      rightOffset: 1,
    });
    chart.timeScale().scrollToRealTime();

    const syncScaleWidth = () => {
      const width = chart.priceScale("right").width() ?? 0;
      setEquityScaleWidth(width);
      setTimeScaleHeight(chart.timeScale().height() ?? 26);
    };
    const scaleFrame = requestAnimationFrame(syncScaleWidth);
    const scaleObserver = new ResizeObserver(syncScaleWidth);
    scaleObserver.observe(container);

    const pane = chart.panes()[0];
    const primitive = createRecessionBandsPrimitive(
      bands,
      selectedIdRef.current,
    );
    pane?.attachPrimitive(primitive);
    primitiveRef.current = primitive;
    const coreIndexPrimitive = createCoreIndexHistogramPrimitive(
      coreIndexData,
      isDark,
    );
    pane?.attachPrimitive(coreIndexPrimitive);

    const pointsByTime = new Map(
      timeline.map((point) => [point.date, point]),
    );
    const crashForTime = (time) => {
      if (typeof time !== "string") return null;
      return (
        (crashes ?? []).find(
          (crash) => time >= crash.start && time <= crash.end,
        ) ?? null
      );
    };

    const handleCrosshair = (param) => {
      if (!param?.time) {
        setHoveredCrashId(null);
        return;
      }
      const key =
        typeof param.time === "string" ? param.time : String(param.time);
      const crash = crashForTime(key);
      const point = pointsByTime.get(key) ?? null;
      setHoveredPoint(point);
      setHoveredCrashId(crash?.id ?? null);
      onHoverPointRef.current?.(point);
    };

    const handleClick = (param) => {
      const crash = crashForTime(param?.time);
      if (crash) onSelect?.(crash);
    };

    chart.subscribeCrosshairMove(handleCrosshair);
    chart.subscribeClick(handleClick);

    if (selectedIdRef.current) {
      const activeCrash = (crashes ?? []).find(
        (crash) => crash.id === selectedIdRef.current,
      );
      if (activeCrash) applyCrashZoom(chart, activeCrash);
    }

    return () => {
      cancelAnimationFrame(scaleFrame);
      scaleObserver.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.unsubscribeClick(handleClick);
      if (primitiveRef.current === primitive) primitiveRef.current = null;
      try {
        pane?.detachPrimitive(primitive);
        pane?.detachPrimitive(coreIndexPrimitive);
      } catch {
        // The chart may already have torn down the primitives.
      }
      if (chartRef.current === chart) chartRef.current = null;
      chart.remove();
    };
  }, [
    assetKey,
    bands,
    coreIndexData,
    compareAssets,
    crashes,
    isDark,
    onSelect,
    seriesData,
    seriesKeys,
    timeline,
    tone.axis,
  ]);

  useEffect(() => {
    const primitive = primitiveRef.current;
    if (primitive) {
      primitive.selectedId = selectedId;
      primitive.requestUpdate();
    }

    if (chartRef.current && selectedCrash) {
      applyCrashZoom(chartRef.current, selectedCrash);
    }
  }, [selectedCrash, selectedId]);

  useEffect(() => {
    const primitive = primitiveRef.current;
    if (primitive) {
      primitive.hoveredId = hoveredCrashId;
      primitive.requestUpdate();
    }
  }, [hoveredCrashId]);

  if (!Array.isArray(timeline) || timeline.length === 0) return null;

  return (
    <section
      aria-labelledby="regime-timeline-title"
      className="relative ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] mt-4 w-screen scroll-mt-24"
    >
      <h2 id="regime-timeline-title" className="sr-only">
        Unified Core Index macro and multi-asset regime chart
      </h2>
      <p className="sr-only">
        One percentage-scaled chart of the S&amp;P 500, London gold, Treasury
        bonds and Nifty 50 with NBER recession shading. A colour-coded Core Index
        histogram from -50 to +50 sits in the lower quarter of the same chart.
        Hover a red NBER band for the crash name, peak-to-trough drawdown and
        Core Index score; click it to zoom to the event.
      </p>

      <div className="sticky top-0 z-30 border-b border-black/5 bg-[#f5f0e8]/85 backdrop-blur-2xl dark:border-white/5 dark:bg-[#06060a]/80">
        <MacroHUD
          point={displayPoint}
          isDark={isDark}
          resolution={resolution}
          activeCrash={selectedCrash}
          assetKey={asset.key}
          onAssetChange={onAssetChange}
          compareAssets={compareAssets}
          onCompareToggle={onCompareToggle}
        />
      </div>

      <div className="relative h-[68vh] min-h-[560px] w-full sm:min-h-[600px]">
        <div
          ref={containerRef}
          data-testid="regime-terminal-chart"
          className="absolute inset-0"
        />

        <ChartCrosshairLegend point={displayPoint} asset={asset} />

        {hoveredMetric ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="crash-hover-tooltip"
            className="pointer-events-none absolute left-1/2 top-16 z-40 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/75 px-3.5 py-2 font-mono text-[10px] font-medium text-white/80 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:top-4 sm:text-micro"
          >
            <span className="text-white/90">{hoveredMetric.name}</span>
            <span className="mx-2 text-white/25">|</span>
            <span className="text-[#ffb4a8]">
              {hoveredMetric.drawdown == null
                ? "—"
                : formatPercent(hoveredMetric.drawdown, 1)}
            </span>
            <span className="mx-2 text-white/25">|</span>
            <span
              style={{
                color: coreIndexTone(
                  hoveredMetric.score == null
                    ? null
                    : hoveredMetric.score >= 25
                      ? "strong_bullish"
                      : hoveredMetric.score >= 0
                        ? "calm_bullish"
                        : hoveredMetric.score > -25
                          ? "bearish_warning"
                          : "extreme_bearish",
                  true,
                ).color,
              }}
            >
              {formatSigned(hoveredMetric.score)}
            </span>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-[#f1ebe2] via-[#f1ebe2]/55 to-transparent dark:from-[#020204] dark:via-[#020204]/55 sm:w-20" />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-[#f1ebe2] via-[#f1ebe2]/55 to-transparent dark:from-[#020204] dark:via-[#020204]/55 sm:w-20"
          style={{ right: equityScaleWidth ? `${equityScaleWidth}px` : 0 }}
        />

        <div
          className="pointer-events-none absolute bottom-8 left-4 z-20 hidden select-none items-baseline gap-2 rounded-full border border-black/5 bg-white/45 px-2.5 py-1 font-mono text-[9px] text-black/40 backdrop-blur-xl dark:border-white/5 dark:bg-black/35 dark:text-white/40 sm:flex"
          style={{ bottom: Math.max(12, timeScaleHeight - 8) }}
        >
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-black/35 dark:text-white/35">
            Core Index
          </span>
          <span>−50</span>
          <span className="text-black/20 dark:text-white/20">/</span>
          <span>0</span>
          <span className="text-black/20 dark:text-white/20">/</span>
          <span>+50</span>
        </div>
      </div>

      <div className="border-t border-black/5 px-3 py-2.5 dark:border-white/5 sm:px-5 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 text-micro text-black/40 dark:text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              {formatDate(coverage?.start)} → {formatDate(coverage?.end)} ·{" "}
              {crashes?.length ?? 0} NBER windows ·{" "}
              {resolution ? `${resolution} tape` : "macro tape"}
            </span>
            <span className="hidden text-black/20 dark:text-white/20 sm:inline">
              /
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#fb7185]" />
              trim risk
              <span className="h-1.5 w-1.5 rounded-full bg-[#facc15]" />
              balanced
              <span className="h-1.5 w-1.5 rounded-full bg-[#fb923c]" />
              preserve
              <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" />
              accumulate
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden sm:inline">
              Hover a red NBER band for drawdown + score · click to zoom.
            </span>
            <label className="inline-flex items-center gap-1.5">
              <span className="sr-only">Jump to NBER recession window</span>
              <select
                value={selectedId ?? ""}
                onChange={(event) => {
                  const crash = (crashes ?? []).find(
                    (item) => item.id === event.target.value,
                  );
                  if (crash) onSelect?.(crash);
                }}
                className="max-w-[13rem] rounded-full border border-black/5 bg-white/45 px-2.5 py-1 font-sans text-micro text-black/55 outline-none focus:border-[#c0442f]/40 dark:border-white/5 dark:bg-black/30 dark:text-white/55"
              >
                <option value="">Jump to an NBER window</option>
                {(crashes ?? []).map((crash) => (
                  <option key={crash.id} value={crash.id}>
                    {crash.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
