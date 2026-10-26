"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
} from "lightweight-charts";
import { CrashTape } from "@/components/regime/CrashTape";
import { MacroHUD } from "@/components/regime/MacroHUD";
import {
  addMonthsIso,
  formatDate,
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
      if (
        endIndex >= timeline.length ||
        timeline[endIndex].date > crash.end
      ) {
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

function applyCrashZoom(chart, crash) {
  if (!chart || !crash) return;
  const from = addMonthsIso(crash.indicator_start, -6);
  const to = addMonthsIso(crash.end, 6);
  if (!from || !to) return;

  try {
    chart.timeScale().setVisibleRange({ from, to });
  } catch {
    // The library clamps ranges that fall outside the loaded time scale.
  }
}

/**
 * NBER recession shading is a pane primitive so it lives behind the price
 * series instead of sitting on top of the line as an HTML overlay would.
 */
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
          context.fillStyle = selected
            ? "rgba(239, 68, 68, 0.19)"
            : "rgba(239, 68, 68, 0.085)";
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
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const primitiveRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [equityScaleWidth, setEquityScaleWidth] = useState(0);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const tone = useMemo(() => getChartTone(isDark), [isDark]);
  const firstProxy = useMemo(
    () =>
      timeline.find(
        (point) =>
          Number.isFinite(point.sp500_proxy) && point.sp500_proxy > 0,
      )?.sp500_proxy ?? null,
    [timeline],
  );
  const latestPoint = timeline.at(-1) ?? null;
  const selectedCrash = useMemo(
    () => (crashes ?? []).find((crash) => crash.id === selectedId) ?? null,
    [crashes, selectedId],
  );
  const selectedPoint = useMemo(
    () =>
      selectedCrash
        ? pointAtOrAfter(timeline, selectedCrash.indicator_start)
        : null,
    [selectedCrash, timeline],
  );
  const displayPoint = hoveredPoint ?? selectedPoint ?? latestPoint;
  const fullStrengthFrom = useMemo(
    () =>
      timeline.find((point) => (point.strength_coverage ?? 0) >= 0.99)
        ?.date ?? null,
    [timeline],
  );

  const bands = useMemo(
    () => buildBands(timeline, crashes),
    [timeline, crashes],
  );

  const primaryData = useMemo(() => {
    if (!firstProxy) return [];
    return timeline.map((point) =>
      Number.isFinite(point.sp500_proxy) && point.sp500_proxy > 0
        ? {
            time: point.date,
            value: (point.sp500_proxy / firstProxy) * 100,
          }
        : { time: point.date },
    );
  }, [timeline, firstProxy]);

  const fedData = useMemo(
    () =>
      timeline
        .filter((point) => point.fed_funds != null)
        .map((point) => ({ time: point.date, value: point.fed_funds })),
    [timeline],
  );

  const curveData = useMemo(
    () =>
      timeline
        .filter((point) => point.t10y2y != null)
        .map((point) => ({
          time: point.date,
          value: point.t10y2y,
          color:
            Number(point.t10y2y) < 0
              ? isDark
                ? "rgba(251, 113, 133, 0.72)"
                : "rgba(192, 68, 47, 0.68)"
              : isDark
                ? "rgba(52, 211, 153, 0.58)"
                : "rgba(15, 118, 110, 0.56)",
        })),
    [timeline, isDark],
  );

  const strengthData = useMemo(
    () =>
      timeline
        .filter((point) => point.strength != null)
        .map((point) => ({ time: point.date, value: point.strength })),
    [timeline],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || timeline.length === 0) return undefined;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: tone.axis,
        fontFamily: '"Onest", ui-sans-serif, system-ui, sans-serif',
        fontSize: 10,
        panes: {
          enableResize: false,
          separatorColor: isDark
            ? "rgba(255, 255, 255, 0.045)"
            : "rgba(20, 18, 26, 0.05)",
          separatorHoverColor: "transparent",
        },
      },
      grid: {
        vertLines: {
          color: isDark
            ? "rgba(255, 255, 255, 0.028)"
            : "rgba(20, 18, 26, 0.035)",
        },
        horzLines: {
          color: isDark
            ? "rgba(255, 255, 255, 0.04)"
            : "rgba(20, 18, 26, 0.045)",
        },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: isDark
            ? "rgba(255, 139, 119, 0.62)"
            : "rgba(192, 68, 47, 0.52)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: isDark ? "#f05d49" : "#c0442f",
        },
        horzLine: {
          color: isDark
            ? "rgba(242, 237, 228, 0.2)"
            : "rgba(20, 18, 26, 0.16)",
          width: 1,
          style: LineStyle.Dotted,
          labelBackgroundColor: isDark ? "#24222b" : "#e8e0d4",
        },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        mode: PriceScaleMode.Logarithmic,
        scaleMargins: { top: 0.14, bottom: 0.05 },
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

    const primaryGlow = chart.addSeries(
      LineSeries,
      {
        color: tone.equitySoft,
        lineWidth: 4,
        priceScaleId: "right",
        priceFormat: { type: "price", precision: 0, minMove: 1 },
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
      0,
    );
    const equitySeries = chart.addSeries(
      LineSeries,
      {
        color: tone.equity,
        lineWidth: 2,
        priceScaleId: "right",
        priceFormat: { type: "price", precision: 0, minMove: 1 },
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3.5,
        crosshairMarkerBorderColor: isDark ? "#08080c" : "#f6f1e9",
        crosshairMarkerBackgroundColor: tone.equity,
      },
      0,
    );

    const fedSeries = chart.addSeries(
      LineSeries,
      {
        color: isDark ? "#60a5fa" : "#2563eb",
        lineWidth: 2,
        priceScaleId: "fed",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
      1,
    );

    const curveSeries = chart.addSeries(
      HistogramSeries,
      {
        priceScaleId: "curve",
        base: 0,
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1,
    );

    const strengthGlow = chart.addSeries(
      LineSeries,
      {
        color: tone.strengthSoft,
        lineWidth: 4,
        priceScaleId: "strength",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
      2,
    );
    const strengthSeries = chart.addSeries(
      LineSeries,
      {
        color: tone.strength,
        lineWidth: 2,
        priceScaleId: "strength",
        priceFormat: { type: "price", precision: 1, minMove: 0.1 },
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3.5,
        crosshairMarkerBorderColor: isDark ? "#08080c" : "#f6f1e9",
        crosshairMarkerBackgroundColor: tone.strength,
      },
      2,
    );

    const panes = chart.panes();
    if (panes[0]) {
      panes[0].setStretchFactor(2);
      panes[0].priceScale("right").applyOptions({
        visible: true,
        borderVisible: false,
        mode: PriceScaleMode.Logarithmic,
        scaleMargins: { top: 0.14, bottom: 0.05 },
        entireTextOnly: true,
      });
    }
    if (panes[1]) {
      panes[1].setStretchFactor(1);
      panes[1].priceScale("fed").applyOptions({
        visible: false,
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.53 },
        entireTextOnly: true,
      });
      panes[1].priceScale("curve").applyOptions({
        visible: false,
        borderVisible: false,
        scaleMargins: { top: 0.52, bottom: 0.03 },
        entireTextOnly: true,
      });
    }
    if (panes[2]) {
      panes[2].setStretchFactor(1);
      panes[2].priceScale("strength").applyOptions({
        visible: false,
        borderVisible: false,
        scaleMargins: { top: 0.12, bottom: 0.1 },
        entireTextOnly: true,
      });
    }

    primaryGlow.setData(primaryData);
    equitySeries.setData(primaryData);
    fedSeries.setData(fedData);
    curveSeries.setData(curveData);
    strengthGlow.setData(strengthData);
    strengthSeries.setData(strengthData);

    curveSeries.createPriceLine({
      price: 0,
      color: isDark
        ? "rgba(255, 255, 255, 0.16)"
        : "rgba(20, 18, 26, 0.14)",
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: "",
    });
    strengthSeries.createPriceLine({
      price: 50,
      color: isDark
        ? "rgba(242, 237, 228, 0.22)"
        : "rgba(20, 18, 26, 0.2)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: "",
    });

    chart.timeScale().fitContent();

    const syncScaleWidth = () => {
      const width = panes[0]?.priceScale("right").width() ?? 0;
      setEquityScaleWidth(width);
    };
    const scaleFrame = requestAnimationFrame(syncScaleWidth);
    const scaleObserver = new ResizeObserver(syncScaleWidth);
    scaleObserver.observe(container);

    const primitive = createRecessionBandsPrimitive(
      bands,
      selectedIdRef.current,
    );
    panes[0]?.attachPrimitive(primitive);
    primitiveRef.current = primitive;

    const pointsByTime = new Map(
      timeline.map((point) => [point.date, point]),
    );
    const handleCrosshairMove = (param) => {
      if (!param?.time || !param.point) {
        setHoveredPoint(null);
        return;
      }
      const key =
        typeof param.time === "string" ? param.time : String(param.time);
      setHoveredPoint(pointsByTime.get(key) ?? null);
    };
    chart.subscribeCrosshairMove(handleCrosshairMove);

    const activeCrash = (crashes ?? []).find(
      (crash) => crash.id === selectedIdRef.current,
    );
    if (activeCrash) applyCrashZoom(chart, activeCrash);

    return () => {
      cancelAnimationFrame(scaleFrame);
      scaleObserver.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      if (primitiveRef.current === primitive) primitiveRef.current = null;
      try {
        panes[0]?.detachPrimitive(primitive);
      } catch {
        // The chart may already have torn down the primitive.
      }
      if (chartRef.current === chart) chartRef.current = null;
      chart.remove();
    };
  }, [
    bands,
    crashes,
    curveData,
    fedData,
    isDark,
    primaryData,
    strengthData,
    timeline,
    tone,
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

  if (!Array.isArray(timeline) || timeline.length === 0) return null;

  return (
    <section
      aria-labelledby="regime-timeline-title"
      className="relative ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] mt-4 w-screen scroll-mt-24"
    >
      <h2 id="regime-timeline-title" className="sr-only">
        Immersive 120-year macro regime terminal
      </h2>
      <p className="sr-only">
        Three synchronized lightweight-charts panes: a log-scale equity proxy
        with NBER recession shading, Fed Funds and 10Y–2Y yield curve, and the
        0–100 macro strength oscillator. Hover the chart to update the macro
        HUD. Use the NBER dossier rail to zoom to a recession window.
      </p>

      <div className="sticky top-0 z-30 border-b border-black/5 bg-[#f5f0e8]/80 backdrop-blur-2xl dark:border-white/5 dark:bg-[#06060a]/75">
        <MacroHUD
          point={displayPoint}
          isDark={isDark}
          resolution={resolution}
          activeCrash={selectedCrash}
        />
        <CrashTape
          crashes={crashes}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>

      <div className="relative h-[68vh] min-h-[560px] w-full">
        <div
          ref={containerRef}
          data-testid="regime-terminal-chart"
          className="absolute inset-0"
        />

        <div className="pointer-events-none absolute left-4 top-2 z-20 text-[10px] font-medium uppercase tracking-[0.18em] text-black/30 dark:text-white/30 sm:left-7">
          01 · Equity proxy <span className="normal-case tracking-normal">· rebased 100 · log</span>
        </div>
        <div className="pointer-events-none absolute left-4 top-[calc(50%+0.75rem)] z-20 text-[10px] font-medium uppercase tracking-[0.18em] text-black/30 dark:text-white/30 sm:left-7">
          02 · Rates &amp; yield <span className="normal-case tracking-normal">· Fed funds / 10Y–2Y</span>
        </div>
        <div className="pointer-events-none absolute left-4 top-[calc(75%+0.75rem)] z-20 text-[10px] font-medium uppercase tracking-[0.18em] text-black/30 dark:text-white/30 sm:left-7">
          03 · Macro momentum <span className="normal-case tracking-normal">· baseline 50</span>
        </div>

        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-[#f1ebe2] via-[#f1ebe2]/55 to-transparent dark:from-[#020204] dark:via-[#020204]/55 sm:w-20" />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-[#f1ebe2] via-[#f1ebe2]/55 to-transparent dark:from-[#020204] dark:via-[#020204]/55 sm:w-20"
          style={{ right: equityScaleWidth ? `${equityScaleWidth}px` : 0 }}
        />
      </div>

      <div className="border-t border-black/5 px-3 py-2.5 dark:border-white/5 sm:px-5 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-1 text-micro text-black/40 dark:text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {formatDate(coverage?.start)} → {formatDate(coverage?.end)} ·{" "}
            {crashes?.length ?? 0} NBER windows ·{" "}
            {resolution ? `${resolution} tape` : "macro tape"}
          </span>
          <span>
            {firstProxy != null
              ? "Equity proxy rebased to 100 at first observation; log scale."
              : "No equity proxy in this window."}{" "}
            {fullStrengthFrom
              ? `Full composite coverage from ${formatDate(fullStrengthFrom)}.`
              : "Strength coverage is partial."}
          </span>
        </div>
      </div>
    </section>
  );
}
