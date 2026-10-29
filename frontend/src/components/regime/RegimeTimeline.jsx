"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
} from "lightweight-charts";
import {
  CARD_LEFT,
  CARD_WIDTH,
  ChartCrosshairLegend,
} from "@/components/regime/ChartCrosshairLegend";
import { MacroHUD } from "@/components/regime/MacroHUD";
import {
  ASSET_ORDER,
  ASSET_TARGETS,
  assetChartColor,
  getAssetTarget,
} from "@/components/regime/assetTargets";
import {
  CORE_INDEX_BUCKETS,
  clamp,
  coreIndexTone,
  formatDate,
  formatPercent,
  formatSigned,
  getChartTone,
} from "@/components/regime/regimeUtils";
import {
  MARKET_FLAGS,
  assetLabelAt,
  bucketEnvelope,
  chartTimeToIso,
  coreIndexFlag,
  formatAssetValue,
  formatChartTick,
  indexAxisLevels,
  marketFlagText,
  monotoneCurveAt,
  monotoneTangents,
  refineLevelOfDetail,
  selectLevelOfDetail,
  steadyBucketWidth,
  steadyTolerance,
  traceMonotoneCurve,
  traceQuadraticBSpline,
} from "@/components/regime/regimeChart";

// Keyboard slider steps over chart points: ±1 week, ±52 weeks (about a year).
const PAGE_STEP = 52;
const FOCUS_RING_INSET =
  "focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[var(--sh-focus,rgba(240,93,73,0.55))]";
// Level of detail for the drawn price lines: about one point per 2-3 px at
// rest (a coarser 6 px, with a looser tolerance, on panes under 640 px, where
// ten years share about 330 px, so the phone line stays calm) and every week
// once weeks are 2 px or more apart. No weekly close is further than the
// tolerance from the drawn line, and a peak or trough that is the extreme
// within LOD_REACH buckets either side, or of an NBER window, is always drawn
// exactly.
const LOD_TARGET_PX = 2;
const LOD_TOLERANCE_PX = 6;
const LOD_NARROW_PANE_PX = 640;
const LOD_NARROW_TARGET_PX = 6;
const LOD_NARROW_TOLERANCE_PX = 14;
const LOD_REACH = 6;
const LOD_CACHE_SIZE = 8;
// The Core Index ribbon at rest: the weekly range taken from zero, over
// buckets √2 narrower than the price line's (about 1.4-2 px; they follow its
// width, so a zoom reselects both together), each held RIBBON_BACK buckets
// after it and shown at most RIBBON_AHEAD bucket before it. Its two outer
// edges carry the stroke, which fades out within RIBBON_EDGE_FADE points of
// zero. Weekly from 2 px per week.
const RIBBON_BACK = 3;
const RIBBON_AHEAD = 1;
const RIBBON_EDGE_FADE = 6;
// One price-axis width (the widest round label fits), so the plot never
// changes width while zooming, scrubbing or switching assets.
const PRICE_AXIS_WIDTH = 64;
const AXIS_LABEL_LIMIT = 10;
const AXIS_LABEL_GAP = 60;
const AXIS_LABEL_X = 8;
const CHART_FONT = '"Onest", ui-sans-serif, system-ui, sans-serif';
const CHART_FONT_SIZE = 11;
// The time axis is 28 px tall with an 11 px font (measured; read again once
// the chart is up).
const TIME_AXIS_HEIGHT = 28;
// The Core Index ribbon fills the lower quarter of the pane; the price scale
// keeps its bottom 32 % free for it (scaleMargins.bottom).
const RIBBON_TOP = 0.71;
const RIBBON_HEIGHT = 0.26;
const RIBBON_BANDS = [
  "strong_bullish",
  "calm_bullish",
  "bearish_warning",
  "extreme_bearish",
];
// The chart key's words for the four bands, top to bottom.
const RIBBON_KEY = [
  ["strong_bullish", "trim risk"],
  ["calm_bullish", "balanced"],
  ["bearish_warning", "preserve"],
  ["extreme_bearish", "accumulate"],
];
// The ribbon's fill alpha at 0, ±25 and ±50: quiet at the neutral line and
// fuller towards the extremes, so the shape's outer edge reads first.
const RIBBON_FILL_ALPHA = { dark: [0.05, 0.14, 0.26], light: [0.06, 0.16, 0.28] };
// The price area ends at 68 % of the pane (scaleMargins.bottom 0.32); axis
// labels may sit down to its foot, so the 0% level keeps its label there.
const PRICE_AREA_BOTTOM = 0.68;
// The market flags' marks at the foot of the plot: one 2 px lane per flag,
// 1 px above the time axis, lanes 2 px apart.
const FLAG_STRIP_PX = 2;
const FLAG_STRIP_INSET_PX = 1;
const FLAG_STRIP_GAP_PX = 2;
// The snapshot card's height on a plain week from sm (it is display:none at
// rest): what the card's drop under the stuck HUD allows for until measured.
const CARD_REST_HEIGHT = 214;
// The flag strip's lanes for screen readers: each rule as the strip covers
// it (the trend rule ran on the S&P 90 before the S&P 500 began).
const MARKET_FLAG_SPOKEN = {
  core_index_trend_warning:
    "the S&P 500, the S&P 90 before March 1957, below its 40-week average",
  core_index_fast_warning: "down 7% or more in two weeks",
};

function withAlpha(hex, alpha) {
  const value = Number.parseInt(String(hex).replace("#", ""), 16);
  if (!Number.isFinite(value)) return hex;
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function lowerBoundByTime(items, time) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (items[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function lowerBoundSorted(values, value) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function crashAt(crashes, date) {
  if (typeof date !== "string") return null;
  return (
    (crashes ?? []).find((crash) => date >= crash.start && date <= crash.end) ??
    null
  );
}

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

// The resting frame: the latest 30 years (12 on phones), up to the last week.
// Bar spacing and right offset are set outright, in one frame: no glide
// (scrollToRealTime animates, ignores reduced motion and stops short).
function applyOverview(chart, container) {
  if (!chart) return;
  const viewportWidth = container?.clientWidth || 1200;
  const targetYears = viewportWidth < 640 ? 12 : 30;
  chart.timeScale().applyOptions({
    barSpacing: Math.max(0.02, viewportWidth / (52 * targetYears)),
    rightOffset: 1,
  });
}

// The snapshot card sits at the chart's top left (about 28-272 px). Once the
// point being read comes under it, the card moves to the right; the 300/380
// gap keeps it from flickering at the boundary.
function legendSideFor(side, x) {
  if (side === "left") return x < 300 ? "right" : "left";
  return x > 380 ? "left" : "right";
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

function rememberSelection(cache, key, compute) {
  let value = cache.get(key);
  if (value === undefined) {
    value = compute();
    cache.set(key, value);
    if (cache.size > LOD_CACHE_SIZE) cache.delete(cache.keys().next().value);
  }
  return value;
}

// Each point's logical index on the chart's time scale (the union of every
// drawn series' weeks), or null before the data is in.
function chartPositions(timeScale, points) {
  const positions = new Float64Array(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const logical = timeScale.timeToIndex(points[index].time, false);
    if (logical == null) return null;
    positions[index] = logical;
  }
  return positions;
}

// The points that lie on the chart's time scale, as their indices into
// `points` and their logical positions, or null while none does. Under a gold,
// bonds or Nifty line the scale starts decades after the Core Index (1928),
// so its earlier weeks have no place on it.
function positionsOnScale(timeScale, points, timeOf = (point) => point.time) {
  const kept = [];
  const positions = [];
  for (let index = 0; index < points.length; index += 1) {
    const logical = timeScale.timeToIndex(timeOf(points[index]), false);
    if (logical == null) continue;
    kept.push(index);
    positions.push(logical);
  }
  return kept.length
    ? { kept: Int32Array.from(kept), positions: Float64Array.from(positions) }
    : null;
}

// Logical position → x (CSS px). The time scale is linear in the logical
// index, but logicalToCoordinate answers 0 for a fractional index, so map
// from two integer anchors instead (bucket means are fractional).
function logicalToX(timeScale, near) {
  const anchor = Math.round(near);
  const x0 = timeScale.logicalToCoordinate(anchor);
  const x1 = timeScale.logicalToCoordinate(anchor + 1);
  if (x0 == null || x1 == null) return null;
  const spacing = x1 - x0;
  return (logical) => x0 + (logical - anchor) * spacing;
}

// Entries start..end (inclusive) of an ascending list to draw for logical
// positions from..to, with one entry beyond each edge so lines reach them.
function visibleSpan(count, positionAt, from, to) {
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (positionAt(middle) < from) low = middle + 1;
    else high = middle;
  }
  const start = Math.max(0, low - 1);
  high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (positionAt(middle) <= to) low = middle + 1;
    else high = middle;
  }
  return [start, Math.min(count - 1, low)];
}

function curveThrough(count, xAt, yAt) {
  const size = Math.max(0, count);
  const xs = new Float64Array(size);
  const ys = new Float64Array(size);
  for (let k = 0; k < size; k += 1) {
    xs[k] = xAt(k);
    ys[k] = yAt(k);
  }
  return { xs, ys, tangents: monotoneTangents(xs, ys, size), count: size };
}

function strokeCurve(context, curve, color, width) {
  if (!curve || curve.count < 2) return;
  context.beginPath();
  traceMonotoneCurve(context, curve.xs, curve.ys, curve.tangents, 0, curve.count - 1);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

// A vertical gradient in the four Core Index band tones (+50…+25, +25…0,
// 0…−25, −25…−50) that changes exactly at the band edges.
function bandGradient(context, zeroY, half, isDark, alpha) {
  const gradient = context.createLinearGradient(0, zeroY - half, 0, zeroY + half);
  const edge = 0.125 / Math.max(1, half);
  RIBBON_BANDS.forEach((bucket, index) => {
    const meta = CORE_INDEX_BUCKETS[bucket];
    const color = withAlpha(isDark ? meta.dark : meta.light, alpha);
    gradient.addColorStop(index === 0 ? 0 : index / 4 + edge, color);
    gradient.addColorStop(index === 3 ? 1 : (index + 1) / 4 - edge, color);
  });
  return gradient;
}

// The ribbon's fill: the same band tones, quiet at the zero line and fuller
// towards ±50 (RIBBON_FILL_ALPHA), so the extremes read first.
function rampGradient(context, zeroY, half, isDark) {
  const [atZero, atQuarter, atEdge] = isDark
    ? RIBBON_FILL_ALPHA.dark
    : RIBBON_FILL_ALPHA.light;
  const tone = (bucket) => {
    const meta = CORE_INDEX_BUCKETS[bucket];
    return isDark ? meta.dark : meta.light;
  };
  const gradient = context.createLinearGradient(0, zeroY - half, 0, zeroY + half);
  const edge = 0.125 / Math.max(1, half);
  const stops = [
    [0, "strong_bullish", atEdge],
    [0.25 - edge, "strong_bullish", atQuarter],
    [0.25 + edge, "calm_bullish", atQuarter],
    [0.5 - edge, "calm_bullish", atZero],
    [0.5 + edge, "bearish_warning", atZero],
    [0.75 - edge, "bearish_warning", atQuarter],
    [0.75 + edge, "extreme_bearish", atQuarter],
    [1, "extreme_bearish", atEdge],
  ];
  for (const [offset, bucket, alpha] of stops) {
    gradient.addColorStop(offset, withAlpha(tone(bucket), alpha));
  }
  return gradient;
}

// The ribbon edges' ink: the band tones of bandGradient, fading out within
// RIBBON_EDGE_FADE points of zero, so an edge that lies on the zero line (no
// reading on that side) draws nothing over it.
function edgeGradient(context, zeroY, half, isDark) {
  const tone = (bucket, alpha) => {
    const meta = CORE_INDEX_BUCKETS[bucket];
    return withAlpha(isDark ? meta.dark : meta.light, alpha);
  };
  const gradient = context.createLinearGradient(0, zeroY - half, 0, zeroY + half);
  const edge = 0.125 / Math.max(1, half);
  const fade = RIBBON_EDGE_FADE / 100;
  const stops = [
    [0, "strong_bullish", 0.9],
    [0.25 - edge, "strong_bullish", 0.9],
    [0.25 + edge, "calm_bullish", 0.9],
    [0.5 - fade, "calm_bullish", 0.9],
    [0.5, "calm_bullish", 0],
    [0.5, "bearish_warning", 0],
    [0.5 + fade, "bearish_warning", 0.9],
    [0.75 - edge, "bearish_warning", 0.9],
    [0.75 + edge, "extreme_bearish", 0.9],
    [1, "extreme_bearish", 0.9],
  ];
  for (const [offset, bucket, alpha] of stops) {
    gradient.addColorStop(offset, tone(bucket, alpha));
  }
  return gradient;
}

// The lowest and the highest point of each window (NBER recessions), as
// sorted indices into `points`.
function windowExtremes(points, windows) {
  const picks = new Set();
  for (const span of windows ?? []) {
    let low = -1;
    let high = -1;
    for (
      let index = lowerBoundByTime(points, span.start);
      index < points.length && points[index].time <= span.end;
      index += 1
    ) {
      if (low < 0 || points[index].value < points[low].value) low = index;
      if (high < 0 || points[index].value > points[high].value) high = index;
    }
    if (low >= 0) picks.add(low);
    if (high >= 0) picks.add(high);
  }
  return Int32Array.from(picks).sort();
}

// One asset line, drawn by a primitive at its level of detail: about one
// point per 2-3 px at rest, every week once weeks are 2 px or more apart (a
// crash zoom). Points join as a monotone curve, which never overshoots a peak
// or a trough. The hidden full-resolution series it is attached to keeps
// driving the crosshair, the readouts and the autoscale.
function createLevelOfDetailLinePrimitive(points, { color, lineWidth, glowColor, windows }) {
  const levels = Float64Array.from(points, (point) => Math.log10(point.value));
  const every = Int32Array.from(points, (_, index) => index);
  // Each NBER window's trough and peak are always drawn, at any zoom.
  const keep = windowExtremes(points, windows);
  const selections = new Map();
  let positions = null;
  let path = null;
  let pathKey = "";
  // The level of detail in use; it holds through small zoom steps.
  let width = 0;
  let tolerance = 0;

  // Recomputed only when the visible range, the pane size or the price scale
  // changes (at most once per chart frame), never on a pointer move.
  const ensurePath = (mediaSize) => {
    const { chart, series } = primitive;
    if (!chart || !series || points.length === 0) return null;
    const timeScale = chart.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    const y100 = series.priceToCoordinate(100);
    const y1000 = series.priceToCoordinate(1000);
    if (!range || y100 == null || y1000 == null || y100 === y1000) return null;
    const key = `${range.from}|${range.to}|${mediaSize.width}|${mediaSize.height}|${y100}|${y1000}`;
    if (key === pathKey) return path;
    positions ??= chartPositions(timeScale, points);
    const toX = logicalToX(timeScale, range.from);
    if (!positions || !toX) return null;
    const narrow = mediaSize.width < LOD_NARROW_PANE_PX;
    width = steadyBucketWidth(
      width,
      mediaSize.width / Math.max(1e-6, range.to - range.from),
      narrow ? LOD_NARROW_TARGET_PX : LOD_TARGET_PX,
    );
    // The tolerance in log10 units for the current px per decade.
    tolerance = steadyTolerance(
      tolerance,
      (narrow ? LOD_NARROW_TOLERANCE_PX : LOD_TOLERANCE_PX) / Math.abs(y100 - y1000),
    );
    const selection =
      width === 1
        ? every
        : rememberSelection(selections, `${width}|${tolerance}`, () =>
            refineLevelOfDetail(
              selectLevelOfDetail(positions, levels, width, LOD_REACH, keep),
              positions,
              levels,
              tolerance,
            ),
          );
    const [start, end] = visibleSpan(
      selection.length,
      (k) => positions[selection[k]],
      range.from - width,
      range.to + width,
    );
    path = curveThrough(
      end - start + 1,
      (k) => toX(positions[selection[start + k]]),
      (k) => series.priceToCoordinate(points[selection[start + k]].value),
    );
    pathKey = key;
    return path;
  };

  const renderer = {
    draw: (target) => {
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        const current = ensurePath(mediaSize);
        if (!current) return;
        context.save();
        context.lineJoin = "round";
        context.lineCap = "round";
        if (glowColor) strokeCurve(context, current, glowColor, 5);
        strokeCurve(context, current, color, lineWidth);
        context.restore();
      });
    },
  };
  const views = [{ renderer: () => renderer }];
  const primitive = {
    chart: null,
    series: null,
    attached({ chart, series }) {
      primitive.chart = chart;
      primitive.series = series;
    },
    detached() {
      primitive.chart = null;
      primitive.series = null;
    },
    updateAllViews() {},
    paneViews() {
      return views;
    },
    // The drawn line's y at x (CSS px), so the crosshair mark sits on it.
    yAt(x) {
      return path
        ? monotoneCurveAt(path.xs, path.ys, path.tangents, path.count, x)
        : null;
    },
  };
  return primitive;
}

function pointsThrough(count, xAt, yAt) {
  const size = Math.max(0, count);
  const xs = new Float64Array(size);
  const ys = new Float64Array(size);
  for (let k = 0; k < size; k += 1) {
    xs[k] = xAt(k);
    ys[k] = yAt(k);
  }
  return { xs, ys, count: size };
}

// The Core Index as one calm shape around the zero line.
// At rest (weeks less than 2 px apart) the shape is the weekly range taken
// from zero over narrow buckets (bucketEnvelope), each held RIBBON_BACK
// buckets after it and shown at most RIBBON_AHEAD bucket before it, drawn as
// a quadratic B-spline: every weekly value lies inside it, every top and
// bottom reaches its outer edge, and no reading shows more than about a
// bucket before it happened. The two outer edges carry a fine stroke. Once
// weeks are 2 px or more apart (a crash zoom) the shape follows the weekly
// values. Any −50…+50 series works.
function createCoreIndexRibbonPrimitive(points, isDark) {
  const allValues = Float64Array.from(points, (point) =>
    clamp(Number(point.value), -50, 50),
  );
  const envelopes = new Map();
  // The weeks on the chart's time scale and their values.
  let positions = null;
  let values = null;
  let shape = null;
  let shapeKey = "";
  let geometry = null;
  // The level of detail in use; it holds through small zoom steps.
  let bandWidth = 0;

  const ensureShape = (mediaSize) => {
    const chart = primitive.chart;
    if (!chart) return null;
    const half = (mediaSize.height * RIBBON_HEIGHT) / 2;
    const zeroY = mediaSize.height * RIBBON_TOP + half;
    geometry = { zeroY, half };
    if (allValues.length < 2) return null;
    const timeScale = chart.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (!range) return null;
    const key = `${range.from}|${range.to}|${mediaSize.width}|${mediaSize.height}`;
    if (key === shapeKey) return shape;
    if (!positions) {
      const onScale = positionsOnScale(timeScale, points);
      if (onScale) {
        positions = onScale.positions;
        values = Float64Array.from(onScale.kept, (index) => allValues[index]);
      }
    }
    const toX = logicalToX(timeScale, range.from);
    if (!positions || positions.length < 2 || !toX) return null;
    const pxPerPoint = mediaSize.width / Math.max(1e-6, range.to - range.from);
    const toY = (value) => zeroY - (value / 50) * half;
    bandWidth = steadyBucketWidth(bandWidth, pxPerPoint, LOD_TARGET_PX);
    if (bandWidth === 1) {
      const [start, end] = visibleSpan(
        values.length,
        (k) => positions[k],
        range.from - 1,
        range.to + 1,
      );
      shape = {
        weekly: curveThrough(
          end - start + 1,
          (k) => toX(positions[start + k]),
          (k) => toY(values[start + k]),
        ),
      };
    } else {
      const width = bandWidth * Math.SQRT1_2;
      const envelope = rememberSelection(envelopes, width, () =>
        bucketEnvelope(positions, values, width, {
          back: RIBBON_BACK,
          ahead: RIBBON_AHEAD,
        }),
      );
      // Three control points beyond each edge: a span depends on its
      // neighbours, so the visible part never changes while panning.
      const [start, end] = visibleSpan(
        envelope.at.length,
        (k) => envelope.at[k],
        range.from - 3 * width,
        range.to + 3 * width,
      );
      const x = (k) => toX(envelope.at[start + k]);
      shape = {
        upper: pointsThrough(end - start + 1, x, (k) =>
          toY(envelope.upper[start + k]),
        ),
        lower: pointsThrough(end - start + 1, x, (k) =>
          toY(envelope.lower[start + k]),
        ),
      };
    }
    shapeKey = key;
    return shape;
  };

  // Hairlines one device pixel thick, across the whole pane, as before.
  const drawHairlines = (target, levels, color) => {
    target.useBitmapCoordinateSpace(({ context, bitmapSize, verticalPixelRatio }) => {
      const half = (bitmapSize.height * RIBBON_HEIGHT) / 2;
      const zeroY = bitmapSize.height * RIBBON_TOP + half;
      const thickness = Math.max(1, Math.floor(verticalPixelRatio));
      context.fillStyle = color;
      for (const level of levels) {
        const y = Math.round(zeroY - (level / 50) * half - thickness / 2);
        context.fillRect(0, y, bitmapSize.width, thickness);
      }
    });
  };

  const renderer = {
    draw: (target) => {
      drawHairlines(
        target,
        [-25, 25],
        isDark ? "rgba(242, 237, 228, 0.10)" : "rgba(20, 18, 26, 0.08)",
      );
      target.useMediaCoordinateSpace(({ context, mediaSize }) => {
        const current = ensureShape(mediaSize);
        if (!current) return;
        const { zeroY, half } = geometry;
        const { weekly, upper, lower } = current;
        if (weekly ? weekly.count < 2 : upper.count < 2) return;
        context.save();
        context.beginPath();
        if (weekly) {
          context.moveTo(weekly.xs[0], zeroY);
          traceMonotoneCurve(context, weekly.xs, weekly.ys, weekly.tangents, 0, weekly.count - 1, true);
          context.lineTo(weekly.xs[weekly.count - 1], zeroY);
        } else {
          traceQuadraticBSpline(context, upper.xs, upper.ys, 0, upper.count - 1);
          traceQuadraticBSpline(context, lower.xs, lower.ys, lower.count - 1, 0, true);
        }
        context.closePath();
        context.fillStyle = rampGradient(context, zeroY, half, isDark);
        context.fill();
        context.lineJoin = "round";
        context.lineCap = "round";
        if (weekly) {
          strokeCurve(context, weekly, bandGradient(context, zeroY, half, isDark, 0.9), 1.25);
        } else {
          const ink = edgeGradient(context, zeroY, half, isDark);
          for (const edge of [upper, lower]) {
            context.beginPath();
            traceQuadraticBSpline(context, edge.xs, edge.ys, 0, edge.count - 1);
            context.strokeStyle = ink;
            context.lineWidth = 1.25;
            context.stroke();
          }
        }
        context.restore();
      });
      drawHairlines(
        target,
        [0],
        isDark ? "rgba(242, 237, 228, 0.28)" : "rgba(20, 18, 26, 0.24)",
      );
    },
  };
  const views = [{ renderer: () => renderer }];
  const primitive = {
    chart: null,
    attached({ chart }) {
      primitive.chart = chart;
    },
    detached() {
      primitive.chart = null;
    },
    updateAllViews() {},
    paneViews() {
      return views;
    },
    // A Core Index value's y in the ribbon (CSS px), for the crosshair mark.
    valueToY(value) {
      if (!geometry || !Number.isFinite(Number(value))) return null;
      return geometry.zeroY - (clamp(Number(value), -50, 50) / 50) * geometry.half;
    },
  };
  return primitive;
}

// The market flags (the trend warning, and the fast warning when the data
// carries it) as fine marks at the foot of the plot: one quiet 2 px lane per
// flag, drawn only over the weeks when it is on, at every zoom, never
// animated. Runs of consecutive weeks are found once; a paint draws only the
// runs in view.
function createFlagStripPrimitive(timeline, lanes) {
  let runs = null;

  const ensureRuns = (timeScale) => {
    if (runs) return runs;
    const onScale = positionsOnScale(timeScale, timeline, (point) => point.date);
    if (!onScale) return null;
    runs = lanes.map((lane) => {
      const from = [];
      const to = [];
      let open = false;
      onScale.kept.forEach((pointIndex, k) => {
        const on = timeline[pointIndex][lane.field] === true;
        if (on && open) to[to.length - 1] = onScale.positions[k];
        else if (on) {
          from.push(onScale.positions[k]);
          to.push(onScale.positions[k]);
        }
        open = on;
      });
      return { color: lane.color, from: Float64Array.from(from), to: Float64Array.from(to) };
    });
    return runs;
  };

  const renderer = {
    draw: (target) => {
      const chart = primitive.chart;
      if (!chart || lanes.length === 0) return;
      const timeScale = chart.timeScale();
      const range = timeScale.getVisibleLogicalRange();
      const current = ensureRuns(timeScale);
      const toX = range ? logicalToX(timeScale, range.from) : null;
      if (!current || !toX) return;
      target.useBitmapCoordinateSpace(
        ({ context, bitmapSize, horizontalPixelRatio, verticalPixelRatio }) => {
          const thickness = Math.max(1, Math.round(FLAG_STRIP_PX * verticalPixelRatio));
          const step = thickness + Math.round(FLAG_STRIP_GAP_PX * verticalPixelRatio);
          const foot = bitmapSize.height - Math.round(FLAG_STRIP_INSET_PX * verticalPixelRatio);
          current.forEach((lane, index) => {
            const top = foot - thickness - index * step;
            context.fillStyle = lane.color;
            // The first run that ends in view, then every run that starts in it.
            let k = lowerBoundSorted(lane.to, range.from - 1);
            for (; k < lane.from.length && lane.from[k] <= range.to + 1; k += 1) {
              const left = Math.round(toX(lane.from[k] - 0.5) * horizontalPixelRatio);
              const right = Math.round(toX(lane.to[k] + 0.5) * horizontalPixelRatio);
              if (right <= 0 || left >= bitmapSize.width) continue;
              const x = Math.max(0, left);
              const width = Math.min(bitmapSize.width, right) - x;
              context.fillRect(x, top, Math.max(1, width), thickness);
            }
          });
        },
      );
    },
  };
  const views = [{ renderer: () => renderer }];
  const primitive = {
    chart: null,
    attached({ chart }) {
      primitive.chart = chart;
    },
    detached() {
      primitive.chart = null;
    },
    updateAllViews() {},
    paneViews() {
      return views;
    },
  };
  return primitive;
}

// A label's row on the device-pixel grid: the gridline's first bitmap row,
// its thickness and its centre (bitmap px).
function axisRow(y, pixelRatio) {
  const thickness = Math.max(1, Math.floor(pixelRatio));
  const top = Math.round(y * pixelRatio - thickness / 2);
  return { top, thickness, centre: top + thickness / 2 };
}

// Exact round labels for the log-scaled price axis (change since the base
// week: 0%, +100%, +300% …), each drawn at its own value, with faint
// gridlines at the same rows. The built-in tick labels are hidden. Labels are
// drawn here rather than as axis views so each one's ink box is centred on
// its gridline's device-pixel row (an axis view's box puts the text 1-2 px
// low). Where the ink box and the row cannot share a centre (an even ink
// height on a one-pixel row at 1x), the label sits half a pixel high.
// `base` (an index level, or null for the chart's own base week) moves 0% to
// another week for the labels only: an open NBER window reads as change since
// its first week. The lines and the data do not move.
function createIndexAxisPrimitive({ textColor, gridColor, fontWeight, base = null }) {
  let labels = [];
  let labelsKey = "";
  const gridRenderer = {
    draw: (target) => {
      target.useBitmapCoordinateSpace(({ context, bitmapSize, verticalPixelRatio }) => {
        context.fillStyle = gridColor;
        for (const label of labels) {
          const row = axisRow(label.y, verticalPixelRatio);
          context.fillRect(0, row.top, bitmapSize.width, row.thickness);
        }
      });
    },
  };
  const labelRenderer = {
    draw: (target) => {
      target.useBitmapCoordinateSpace(
        ({ context, horizontalPixelRatio, verticalPixelRatio }) => {
          context.font = `${fontWeight} ${CHART_FONT_SIZE * verticalPixelRatio}px ${CHART_FONT}`;
          context.fillStyle = textColor;
          context.textAlign = "left";
          context.textBaseline = "alphabetic";
          for (const label of labels) {
            const row = axisRow(label.y, verticalPixelRatio);
            const ink = context.measureText(label.text);
            const baseline = Math.floor(
              row.centre +
                ((ink.actualBoundingBoxAscent || 0) - (ink.actualBoundingBoxDescent || 0)) / 2,
            );
            context.fillText(
              label.text,
              Math.round(AXIS_LABEL_X * horizontalPixelRatio),
              baseline,
            );
          }
        },
      );
    },
  };
  const paneViews = [{ zOrder: () => "bottom", renderer: () => gridRenderer }];
  const axisPaneViews = [{ renderer: () => labelRenderer }];
  const primitive = {
    chart: null,
    series: null,
    base: base > 0 ? base : null,
    requestUpdate: null,
    attached({ chart, series, requestUpdate }) {
      primitive.chart = chart;
      primitive.series = series;
      primitive.requestUpdate = requestUpdate;
    },
    detached() {
      primitive.chart = null;
      primitive.series = null;
      primitive.requestUpdate = null;
      labels = [];
    },
    // A new 0% for the labels (see above); repaints only when it changes.
    setBase(value) {
      const next = value > 0 ? value : null;
      if (next === primitive.base) return;
      primitive.base = next;
      labelsKey = "";
      primitive.requestUpdate?.();
    },
    // Runs after the price scale is recalculated and before the axis and the
    // pane are painted, so labels and gridlines move together with the line.
    updateAllViews() {
      const { chart, series } = primitive;
      if (!chart || !series) return;
      const height = chart.paneSize(0)?.height ?? 0;
      // Labels stay within the price area, above the Core Index ribbon (the
      // axis cell fades out beside it).
      const top = 12;
      const bottom = height * PRICE_AREA_BOTTOM - 2;
      const high = series.coordinateToPrice(top);
      const low = series.coordinateToPrice(bottom);
      // Levels are counted from the label base: 100 there is 0%.
      const scale = primitive.base ? 100 / primitive.base : 1;
      const key = `${height}|${high}|${low}|${scale}`;
      if (key === labelsKey) return;
      labelsKey = key;
      labels =
        high == null || low == null || bottom <= top
          ? []
          : indexAxisLevels(
              Number(low) * scale,
              Number(high) * scale,
              (level) => series.priceToCoordinate(level / scale),
              { gap: AXIS_LABEL_GAP, top, bottom },
            ).slice(0, AXIS_LABEL_LIMIT);
    },
    priceAxisPaneViews() {
      return axisPaneViews;
    },
    paneViews() {
      return paneViews;
    },
  };
  return primitive;
}

// The crosshair marks, on the top layer: a dot on each drawn price line at
// the crosshair (on the line as drawn, so it never floats beside it) and a
// dot on the ribbon at the week's Core Index, in its band's tone.
function createCrosshairMarksPrimitive({ lines, ribbon, weeks, ringColor }) {
  const dot = (context, x, y, radius, fill) => {
    context.beginPath();
    context.arc(x, y, radius + 1.5, 0, Math.PI * 2);
    context.fillStyle = ringColor;
    context.fill();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = fill;
    context.fill();
  };
  const renderer = {
    draw: (target) => {
      const { chart, time } = primitive;
      if (!chart || !time) return;
      const x = chart.timeScale().timeToCoordinate(time);
      if (x == null) return;
      target.useMediaCoordinateSpace(({ context }) => {
        for (const line of lines) {
          const y = line.primitive.yAt(x);
          if (y != null) dot(context, x, y, 3.5, line.color);
        }
        const week = weeks.get(time);
        const y = week ? ribbon.valueToY(week.value) : null;
        if (y != null) dot(context, x, y, 3, week.color);
      });
    },
  };
  const views = [{ zOrder: () => "top", renderer: () => renderer }];
  const primitive = {
    chart: null,
    // The week under the crosshair ("YYYY-MM-DD"), or null when it is hidden.
    time: null,
    attached({ chart }) {
      primitive.chart = chart;
    },
    detached() {
      primitive.chart = null;
      primitive.time = null;
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
  const hudRef = useRef(null);
  const chartBoxRef = useRef(null);
  const onHoverPointRef = useRef(onHoverPoint);
  const chartRef = useRef(null);
  const lineSeriesRef = useRef({});
  const primitiveRef = useRef(null);
  const marksRef = useRef(null);
  const axisRef = useRef(null);
  const labelBaseRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  const previousSelectedIdRef = useRef(selectedId);
  const zoomedIdRef = useRef(selectedId);
  const openerRef = useRef(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [hoveredCrashId, setHoveredCrashId] = useState(null);
  const [crosshairActive, setCrosshairActive] = useState(false);
  const [legendSide, setLegendSide] = useState("left");
  // The axis is a fixed width, so the first paint is already final.
  const [equityScaleWidth, setEquityScaleWidth] = useState(PRICE_AXIS_WIDTH);
  const [timeScaleHeight, setTimeScaleHeight] = useState(TIME_AXIS_HEIGHT);
  const [chartWidth, setChartWidth] = useState(0);
  // The axis's 0% while the view is in deep history (see labelBase); the ref
  // is what the chart's range handler reads.
  const [viewBase, setViewBaseState] = useState(null);
  const viewBaseRef = useRef(null);
  const setViewBase = useCallback((next) => {
    viewBaseRef.current = next;
    setViewBaseState(next);
  }, []);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Closing the crash panel removes its focused Close button; hand focus back
  // to the control that opened it (the NBER select or the chart slider).
  useEffect(() => {
    const previous = previousSelectedIdRef.current;
    previousSelectedIdRef.current = selectedId;
    if (!previous || selectedId) return;
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener?.isConnected) return;
    const active = document.activeElement;
    if (
      !active ||
      active === document.body ||
      active.closest?.('section[aria-label$="crash detail"]')
    ) {
      opener.focus();
    }
  }, [selectedId]);

  useEffect(() => {
    onHoverPointRef.current = onHoverPoint;
  }, [onHoverPoint]);

  // The page keeps in-page scrolling and keyboard focus clear of the stuck
  // HUD: its height goes to --regime-hud-h on the scrolling <main>, which adds
  // it to the header clearance in scroll-padding-top where the HUD sticks.
  const hasTimeline = Array.isArray(timeline) && timeline.length > 0;
  useEffect(() => {
    const hud = hudRef.current;
    const page = hud?.closest("main");
    if (!hud || !page) return undefined;
    const sync = () =>
      page.style.setProperty(
        "--regime-hud-h",
        `${Math.ceil(hud.getBoundingClientRect().height)}px`,
      );
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(hud);
    return () => {
      observer.disconnect();
      page.style.removeProperty("--regime-hud-h");
    };
  }, [hasTimeline]);

  // While the stuck HUD covers the chart's top (a laptop window scrolled down
  // to the chart's foot, where the ribbon and the flag strip are), the
  // snapshot card and the red-band tooltip drop by the covered height,
  // staying inside the price area. A transform on a CSS variable: no layout
  // shift and no chart rebuild.
  useEffect(() => {
    const hud = hudRef.current;
    const box = chartBoxRef.current;
    const page = box?.closest("main");
    if (!hud || !box || !page) return undefined;
    let frame = 0;
    let last = null;
    const sync = () => {
      frame = 0;
      const covered =
        getComputedStyle(hud).position === "sticky"
          ? hud.getBoundingClientRect().bottom - box.getBoundingClientRect().top
          : 0;
      const card = box.querySelector("[data-regime-card]");
      const cardHeight = card?.offsetHeight || CARD_REST_HEIGHT;
      const room =
        (box.clientHeight - TIME_AXIS_HEIGHT) * PRICE_AREA_BOTTOM - cardHeight - 24;
      const drop = Math.round(Math.max(0, Math.min(covered, room)));
      if (drop === last) return;
      last = drop;
      box.style.setProperty("--regime-card-drop", `${drop}px`);
    };
    const request = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    sync();
    page.addEventListener("scroll", request, { passive: true });
    const observer = new ResizeObserver(request);
    observer.observe(hud);
    observer.observe(box);
    const card = box.querySelector("[data-regime-card]");
    if (card) observer.observe(card);
    return () => {
      cancelAnimationFrame(frame);
      page.removeEventListener("scroll", request);
      observer.disconnect();
      box.style.removeProperty("--regime-card-drop");
    };
  }, [hasTimeline]);

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

  // The market flags this archive carries (a flag the backend does not send
  // yet is left out everywhere, so no space is kept for it).
  const marketFlags = useMemo(
    () =>
      MARKET_FLAGS.filter((flag) =>
        timeline.some((point) => typeof point[flag.field] === "boolean"),
      ),
    [timeline],
  );

  // The percentage scale's base (0%): the first week of the year eight years
  // before the latest week's, so 0% lies inside the resting view on every
  // screen (the latest 9.6-10 years of plot on phones, about 28 elsewhere)
  // and compared assets all start from the same week. The Core Index now
  // reaches back to 1928, so its first week would put 0% decades off screen.
  const baseDate = useMemo(() => {
    const year = Number(timeline.at(-1)?.date?.slice(0, 4));
    if (!Number.isFinite(year)) return timeline[0]?.date;
    const from = `${year - 8}-01-01`;
    return timeline.find((point) => point.date >= from)?.date ?? timeline[0]?.date;
  }, [timeline]);

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

  // While an NBER window is open on a single asset, the axis labels read as
  // change since the window's first week (0% there), so a deep-history window
  // reads 0% … −86% rather than −99.x% against the resting base. With no
  // window open, panning or stepping into deep history (the resting base week
  // off screen) counts from a week in view instead (viewBase, kept by the
  // chart's range handler). Compared assets keep the shared base week, the
  // only one every line is drawn from.
  const labelBase = useMemo(() => {
    if (compareAssets) return null;
    if (selectedCrash) {
      const items = seriesData[assetKey] ?? [];
      const first = items[lowerBoundByTime(items, selectedCrash.start)];
      if (!first || first.time > selectedCrash.end || !(first.value > 0)) return null;
      return { date: first.time, value: first.value, kind: "window" };
    }
    return viewBase ? { date: viewBase.date, value: viewBase.value, kind: "view" } : null;
  }, [selectedCrash, compareAssets, seriesData, assetKey, viewBase]);
  const zeroDate = labelBase?.date ?? baseDate;

  // The keyboard slider walks the dates drawn on the chart (the union of the
  // visible series), so every step lands where the crosshair can go.
  const navTimes = useMemo(() => {
    const times = new Set();
    for (const key of seriesKeys) {
      for (const item of seriesData[key] ?? []) times.add(item.time);
    }
    return Array.from(times).sort();
  }, [seriesData, seriesKeys]);

  const navIndex = useMemo(() => {
    if (navTimes.length === 0) return 0;
    if (!displayPoint?.date) return navTimes.length - 1;
    return Math.min(
      lowerBoundSorted(navTimes, displayPoint.date),
      navTimes.length - 1,
    );
  }, [navTimes, displayPoint]);

  // The snapshot card pads the asset readout to the widest value in the
  // archive, so the card's figures keep one width while scrubbing. Prices are
  // positive: the widest is the largest value, or the largest of those below
  // 100, which carry two decimals on the S&P series (formatAssetValue).
  const assetValueChars = useMemo(() => {
    let largest = null;
    let largestBelow100 = null;
    for (const point of timeline) {
      const value = Number(point[asset.valueField]);
      if (!Number.isFinite(value)) continue;
      if (largest == null || value > largest) largest = value;
      if (value < 100 && (largestBelow100 == null || value > largestBelow100)) {
        largestBelow100 = value;
      }
    }
    return Math.max(
      largest == null ? 0 : formatAssetValue(asset, largest).length,
      largestBelow100 == null ? 0 : formatAssetValue(asset, largestBelow100).length,
    );
  }, [timeline, asset]);

  const displayFlag = coreIndexFlag(displayPoint);
  const sliderValueText = displayPoint
    ? [
        formatDate(displayPoint.date),
        `${assetLabelAt(asset, displayPoint)} ${formatAssetValue(
          asset,
          displayPoint[asset.valueField],
        )}`,
        `Core Index ${formatSigned(displayPoint.core_index)}`,
        coreIndexTone(displayPoint.core_index_bucket, isDark).label,
        // "Warning, decline class crash" (the card's "Decline class: crash"
        // without a second colon).
        displayFlag
          ? [
              displayFlag.label,
              displayFlag.text
                ? `decline class ${displayPoint.core_index_severity}`
                : null,
            ]
              .filter(Boolean)
              .join(", ")
          : null,
        ...marketFlags
          .filter((flag) => displayPoint[flag.field] === true)
          .map((flag) => `${flag.label}: ${marketFlagText(flag, displayPoint)}`),
        crashAt(crashes, displayPoint.date)?.name,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Awaiting market archive";

  const drawCrosshairAt = (time) => {
    const chart = chartRef.current;
    if (!chart || !time) return;
    const place = () => {
      for (const key of [assetKey, ...seriesKeys]) {
        const items = seriesData[key] ?? [];
        const item = items[lowerBoundByTime(items, time)];
        const series = lineSeriesRef.current[key];
        if (series && item?.time === time) {
          chart.setCrosshairPosition(item.value, time, series);
          // A synthetic position fires no crosshair event: move the marks too.
          if (marksRef.current) marksRef.current.time = time;
          return;
        }
      }
    };
    try {
      const timeScale = chart.timeScale();
      const logical = timeScale.timeToIndex(time, true);
      const range = timeScale.getVisibleLogicalRange();
      if (logical != null && range) {
        const span = range.to - range.from;
        const pad = Math.min(span / 4, Math.max(2, span * 0.04));
        const shift =
          logical > range.to - pad
            ? logical - (range.to - pad)
            : logical < range.from + pad
              ? logical - (range.from + pad)
              : 0;
        if (shift) {
          // The library applies a new range on its next frame. Clear the
          // crosshair first (silently, so no stray "left the chart" event
          // hides the snapshot) and place it once the range is in, so it
          // lands on the date rather than on the old pixel.
          chart.clearCrosshairPosition();
          if (marksRef.current) marksRef.current.time = null;
          timeScale.setVisibleLogicalRange({
            from: range.from + shift,
            to: range.to + shift,
          });
          requestAnimationFrame(() => {
            if (chartRef.current !== chart) return;
            try {
              place();
            } catch {
              // The chart may have been rebuilt in the meantime.
            }
          });
          return;
        }
      }
      place();
    } catch {
      // If the library rejects the position, the HUD and legend still update.
    }
  };

  const moveSliderTo = (index) => {
    const time = navTimes[index];
    if (!time) return;
    const pointIndex = lowerBoundByDate(timeline, time);
    const point =
      timeline[pointIndex]?.date === time ? timeline[pointIndex] : null;
    drawCrosshairAt(time);
    const x = chartRef.current?.timeScale().timeToCoordinate(time);
    if (x != null) setLegendSide((side) => legendSideFor(side, x));
    setHoveredPoint(point);
    setHoveredCrashId(crashAt(crashes, time)?.id ?? null);
    setCrosshairActive(true);
    onHoverPointRef.current?.(point);
  };

  const handleSliderKeyDown = (event) => {
    const last = navTimes.length - 1;
    if (last < 0) return;
    let next = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = navIndex + 1;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = navIndex - 1;
        break;
      case "PageUp":
        next = navIndex + PAGE_STEP;
        break;
      case "PageDown":
        next = navIndex - PAGE_STEP;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      case "Enter": {
        const crash = crashAt(crashes, displayPoint?.date);
        if (!crash) return;
        event.preventDefault();
        openerRef.current = event.currentTarget;
        onSelect?.(crash);
        return;
      }
      case "Escape":
        if (!hoveredPoint && !crosshairActive) return;
        event.preventDefault();
        chartRef.current?.clearCrosshairPosition();
        if (marksRef.current) marksRef.current.time = null;
        setHoveredPoint(null);
        setHoveredCrashId(null);
        setCrosshairActive(false);
        onHoverPointRef.current?.(null);
        return;
      default:
        return;
    }
    event.preventDefault();
    moveSliderTo(Math.max(0, Math.min(last, next)));
  };

  // Keyboard focus reveals what hover reveals: the crosshair and the snapshot.
  // On a short window the chart is taller than the room under the stuck HUD,
  // and focus can arrive with its top (and the snapshot card) beneath the
  // HUD: its top is brought to just below it (the page's scroll padding),
  // in one step.
  const handleSliderFocus = (event) => {
    const hud = hudRef.current;
    if (
      hud &&
      getComputedStyle(hud).position === "sticky" &&
      event.currentTarget.getBoundingClientRect().top <
        hud.getBoundingClientRect().bottom - 1
    ) {
      event.currentTarget.scrollIntoView({ block: "start" });
    }
    const time = navTimes[navIndex];
    if (!time) return;
    drawCrosshairAt(time);
    const x = chartRef.current?.timeScale().timeToCoordinate(time);
    if (x != null) setLegendSide((side) => legendSideFor(side, x));
    setCrosshairActive(true);
  };

  const handleSliderBlur = () => {
    chartRef.current?.clearCrosshairPosition();
    if (marksRef.current) marksRef.current.time = null;
    setCrosshairActive(false);
  };

  // A crash zoom moves the weeks under the crosshair: the library re-reads
  // it at its old pixel, which is now another week. The week on show stays
  // on show when it lies inside the window (Enter on a band, a click);
  // otherwise the crosshair and the snapshot clear.
  const weekToKeep = useEffectEvent((crash) => {
    const shown = crosshairActive ? hoveredPoint?.date : null;
    return shown && shown >= crash.start && shown <= crash.end ? shown : null;
  });
  const settleCrosshair = useEffectEvent((time) => {
    if (time) {
      moveSliderTo(Math.min(lowerBoundSorted(navTimes, time), navTimes.length - 1));
      return;
    }
    chartRef.current?.clearCrosshairPosition();
    if (marksRef.current) marksRef.current.time = null;
    setHoveredPoint(null);
    setHoveredCrashId(null);
    setCrosshairActive(false);
    onHoverPointRef.current?.(null);
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || timeline.length === 0) return undefined;

    setHoveredPoint(null);
    setHoveredCrashId(null);
    setCrosshairActive(false);

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: tone.axisText,
        fontFamily: CHART_FONT,
        fontSize: CHART_FONT_SIZE,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      localization: {
        priceFormatter: (price) =>
          `${(Number(price) - 100).toFixed(0)}%`,
        // Any date the chart formats reads like every other ("05 Sep 2008").
        timeFormatter: (time) => formatDate(chartTimeToIso(time)),
      },
      // One calm vertical hairline and nothing else: no horizontal line, no
      // price label, and no date pill on the time axis (it covered part of
      // the neighbouring tick labels); the HUD and the snapshot carry the
      // date and the values.
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: isDark
            ? "rgba(242, 237, 228, 0.3)"
            : "rgba(20, 18, 26, 0.26)",
          width: 1,
          style: LineStyle.Solid,
          labelVisible: false,
        },
        horzLine: {
          visible: false,
          labelVisible: false,
        },
      },
      // A fixed width, and the built-in (uneven) tick text hidden: the index
      // axis primitive draws exact round labels instead.
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        mode: PriceScaleMode.Logarithmic,
        scaleMargins: { top: 0.07, bottom: 0.32 },
        entireTextOnly: true,
        minimumWidth: PRICE_AXIS_WIDTH,
        textColor: "rgba(0, 0, 0, 0)",
      },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        secondsVisible: false,
        minBarSpacing: 0.01,
        rightOffset: 1,
        tickMarkFormatter: formatChartTick,
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
    const lineSeries = {};
    const drawnLines = [];

    for (const key of seriesKeys) {
      const target = ASSET_TARGETS[key] ?? ASSET_TARGETS.sp500;
      const color = assetChartColor(target, isDark);
      const selected = key === assetKey;
      const lineWidth = compareAssets ? (selected ? 2.4 : 1.7) : 2.2;

      // The full weekly series stays on the chart but is not drawn: it drives
      // the crosshair, the readouts, the keyboard slider and the autoscale,
      // so every number shown is a true weekly value.
      const line = chart.addSeries(LineSeries, {
        color,
        lineWidth,
        lineVisible: false,
        priceScaleId: "right",
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        // Never "hovered" (a negative hit radius): hovering an undrawn line
        // would only repaint the main layer while scrubbing.
        hitTestTolerance: -1,
      });
      line.setData(seriesData[key] ?? []);
      // What is drawn is the level-of-detail line. A soft underlay marks the
      // primary line only when several are drawn.
      const drawn = createLevelOfDetailLinePrimitive(seriesData[key] ?? [], {
        color,
        lineWidth,
        glowColor: selected && compareAssets ? withAlpha(color, 0.12) : null,
        windows: crashes,
      });
      line.attachPrimitive(drawn);
      drawnLines.push({ primitive: drawn, color });
      lineSeries[key] = line;
    }
    lineSeriesRef.current = lineSeries;

    chart.priceScale("right").applyOptions({
      visible: true,
      borderVisible: false,
      mode: PriceScaleMode.Logarithmic,
      scaleMargins: { top: 0.07, bottom: 0.32 },
      entireTextOnly: true,
    });

    applyOverview(chart, container);

    // The axis's 0% in deep history (one asset, no window open): while the
    // resting base week is off screen, the first week of the first decade
    // year in view (else of the first full year, else the first week),
    // held until it leaves the view, so the 1930s read 0% … −80% rather than
    // −99.x%. Back to the resting base once its week is in view. Labels
    // repaint (axis setBase); the data and the chart stay as they are.
    const viewItems = seriesData[assetKey] ?? [];
    const restIndex = lowerBoundByTime(viewItems, baseDate);
    let viewFrame = 0;
    const readView = () => {
      viewFrame = 0;
      if (compareAssets || viewItems.length === 0) return;
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      const from = Math.max(0, Math.ceil(range.from));
      const to = Math.min(viewItems.length - 1, Math.floor(range.to));
      if (to < from) return;
      const inView = (index) => index >= from && index <= to;
      const held = viewBaseRef.current;
      if (inView(restIndex)) {
        if (held) setViewBase(null);
        return;
      }
      if (held && inView(held.index)) return;
      const firstYear = Number(viewItems[from].time.slice(0, 4));
      const decade = Math.ceil(firstYear / 10) * 10;
      let index = from;
      for (const year of [decade, decade + 10, firstYear + 1]) {
        const candidate = lowerBoundByTime(viewItems, `${year}-01-01`);
        if (inView(candidate)) {
          index = candidate;
          break;
        }
      }
      const item = viewItems[index];
      if (!item || !(item.value > 0)) return;
      setViewBase({ index, date: item.time, value: item.value });
    };
    const handleViewRange = () => {
      if (!viewFrame) viewFrame = requestAnimationFrame(readView);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleViewRange);

    const syncScaleWidth = () => {
      setEquityScaleWidth(chart.priceScale("right").width() || PRICE_AXIS_WIDTH);
      setTimeScaleHeight(chart.timeScale().height() || TIME_AXIS_HEIGHT);
      setChartWidth(container.clientWidth);
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
    const coreIndexPrimitive = createCoreIndexRibbonPrimitive(
      coreIndexData,
      isDark,
    );
    pane?.attachPrimitive(coreIndexPrimitive);
    const flagStrip = createFlagStripPrimitive(
      timeline,
      marketFlags.map((flag) => ({
        field: flag.field,
        color: isDark ? flag.dark : flag.light,
      })),
    );
    pane?.attachPrimitive(flagStrip);
    // Light mode takes the stronger axis ink and a medium weight: thin dark
    // 11 px glyphs on the warm paper otherwise measure about 3-4:1 at their
    // cores.
    const axisPrimitive = createIndexAxisPrimitive({
      textColor: isDark ? tone.axisText : tone.axisStrong,
      gridColor: isDark ? "rgba(242, 237, 228, 0.05)" : "rgba(20, 18, 26, 0.06)",
      fontWeight: isDark ? 400 : 500,
      base: labelBaseRef.current,
    });
    lineSeries[assetKey]?.attachPrimitive(axisPrimitive);
    axisRef.current = axisPrimitive;
    const marks = createCrosshairMarksPrimitive({
      lines: drawnLines,
      ribbon: coreIndexPrimitive,
      weeks: new Map(coreIndexData.map((point) => [point.time, point])),
      ringColor: isDark ? "#08080c" : "#f6f1e9",
    });
    // On a series, so its top-layer view repaints with the crosshair (pane
    // primitives are painted only with the main layer).
    lineSeries[assetKey]?.attachPrimitive(marks);
    marksRef.current = marks;

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
        marks.time = null;
        setHoveredCrashId(null);
        setCrosshairActive(false);
        return;
      }
      const x = param?.point?.x;
      if (x != null) setLegendSide((side) => legendSideFor(side, x));
      const key =
        typeof param.time === "string" ? param.time : String(param.time);
      // Set before the chart paints its top layer on this frame.
      marks.time = key;
      const crash = crashForTime(key);
      const point = pointsByTime.get(key) ?? null;
      setHoveredPoint(point);
      setHoveredCrashId(crash?.id ?? null);
      setCrosshairActive(true);
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
      cancelAnimationFrame(viewFrame);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleViewRange);
      scaleObserver.disconnect();
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.unsubscribeClick(handleClick);
      if (primitiveRef.current === primitive) primitiveRef.current = null;
      if (marksRef.current === marks) marksRef.current = null;
      if (axisRef.current === axisPrimitive) axisRef.current = null;
      try {
        pane?.detachPrimitive(primitive);
        pane?.detachPrimitive(coreIndexPrimitive);
        pane?.detachPrimitive(flagStrip);
      } catch {
        // The chart may already have torn down the primitives.
      }
      if (chartRef.current === chart) chartRef.current = null;
      if (lineSeriesRef.current === lineSeries) lineSeriesRef.current = {};
      chart.remove();
    };
  }, [
    assetKey,
    bands,
    baseDate,
    coreIndexData,
    compareAssets,
    crashes,
    isDark,
    marketFlags,
    onSelect,
    seriesData,
    seriesKeys,
    setViewBase,
    timeline,
    tone.axisStrong,
    tone.axisText,
  ]);

  useEffect(() => {
    const primitive = primitiveRef.current;
    if (primitive) {
      primitive.selectedId = selectedId;
      primitive.requestUpdate();
    }

    let settleFrame = 0;
    const chart = chartRef.current;
    if (chart && selectedCrash) {
      const keep = weekToKeep(selectedCrash);
      applyCrashZoom(chart, selectedCrash);
      // The new range is applied on the chart's next frame (and the library
      // moves the crosshair then); settle it just after.
      settleFrame = requestAnimationFrame(() => {
        if (chartRef.current === chart) settleCrosshair(keep);
      });
    }

    // Closing the detail returns the chart to its resting frame and drops the
    // closed window's snapshot, so the HUD reads the latest week again.
    const previous = zoomedIdRef.current;
    zoomedIdRef.current = selectedId;
    if (previous && !selectedId) {
      applyOverview(chartRef.current, containerRef.current);
      chartRef.current?.clearCrosshairPosition();
      if (marksRef.current) marksRef.current.time = null;
      setCrosshairActive(false);
      setHoveredPoint(null);
      setHoveredCrashId(null);
      onHoverPointRef.current?.(null);
    }
    return () => cancelAnimationFrame(settleFrame);
  }, [selectedCrash, selectedId]);

  useEffect(() => {
    const primitive = primitiveRef.current;
    if (primitive) {
      primitive.hoveredId = hoveredCrashId;
      primitive.requestUpdate();
    }
  }, [hoveredCrashId]);

  // The axis labels' 0% follows the open window (labelBase) without
  // rebuilding the chart; a rebuilt chart starts from the same base.
  useEffect(() => {
    labelBaseRef.current = labelBase?.value ?? null;
    axisRef.current?.setBase(labelBaseRef.current);
  }, [labelBase]);

  if (!Array.isArray(timeline) || timeline.length === 0) return null;

  // The red-band tooltip shows with the snapshot card and keeps clear of it:
  // from 1280 px centred over the chart (clear of the card on either side);
  // narrower, centred in the free space beside the card, its name truncating
  // first, and drawn afresh when the card changes sides. On phones the card is
  // the scrub readout and the tooltip is left out (a tap on a band opens the
  // window's detail, with its drawdown and score).
  const tooltipPlace = (() => {
    if (chartWidth < 640) return null;
    if (chartWidth >= 1280) return { centre: true };
    const cardShift = Math.max(
      0,
      chartWidth - (equityScaleWidth + 28) - CARD_LEFT - CARD_WIDTH,
    );
    const left =
      legendSide === "right" ? CARD_LEFT : CARD_LEFT + CARD_WIDTH + 12;
    const right =
      legendSide === "right"
        ? CARD_LEFT + cardShift - 12
        : chartWidth - equityScaleWidth - 12;
    return right - left >= 160 ? { left, width: right - left } : null;
  })();

  return (
    <section
      aria-labelledby="regime-timeline-title"
      className="relative ml-[calc(50%-50vw)] mr-[calc(50%-50vw)] mt-4 w-screen scroll-mt-24 overflow-clip"
    >
      <h2 id="regime-timeline-title" className="sr-only">
        Unified Core Index macro and multi-asset regime chart
      </h2>
      <p className="sr-only">
        One percentage-scaled chart of the S&amp;P 500, London gold, Treasury
        bonds and Nifty 50 with NBER recession shading; 0% is the week of{" "}
        {formatDate(zeroDate)}
        {labelBase?.kind === "window"
          ? ", the open window's first week"
          : labelBase?.kind === "view"
            ? ", a week in view (in deep history the axis counts from the view)"
            : ""}
        . A colour-coded Core Index ribbon from -50 to +50 sits in the lower
        quarter of the same chart.
        {marketFlags.length
          ? ` A thin strip at its foot marks${
              marketFlags.length > 1
                ? `, in ${marketFlags.length === 2 ? "two" : marketFlags.length} lanes,`
                : ""
            } the weeks with ${marketFlags
              .map((flag) => `a ${flag.label.toLowerCase()} (${MARKET_FLAG_SPOKEN[flag.field] ?? flag.rule})`)
              .join(" and ")}.`
          : ""}{" "}
        Hover a red NBER band for the crash name, peak-to-trough drawdown and
        Core Index score; click it to zoom to the event.
      </p>

      {/* Sticky from sm up where the window has the height for it
          (sm-tall: 40rem wide and tall), just below the fixed site header
          (--sh-header-clear), so nothing hides under the brand or the tab cue.
          The strip above it is covered while it is stuck; at rest that cover
          sits above the section and the section's overflow-clip hides it.
          On phones and short landscape windows the HUD scrolls away so the
          chart gets the screen, and the snapshot card is the scrub readout. */}
      <div
        ref={hudRef}
        className="relative z-30 border-b border-black/5 bg-[#f5f0e8]/85 dark:border-white/5 dark:bg-[#06060a]/80 sm-tall:sticky sm-tall:top-(--sh-header-clear) sm-tall:backdrop-blur-2xl sm-tall:before:pointer-events-none sm-tall:before:absolute sm-tall:before:inset-x-0 sm-tall:before:bottom-full sm-tall:before:h-(--sh-header-clear) sm-tall:before:bg-[#f5f0e8] sm-tall:dark:before:bg-[#06060a]"
      >
        <MacroHUD
          point={displayPoint}
          isDark={isDark}
          resolution={resolution}
          activeCrash={selectedCrash}
          assetKey={asset.key}
          onAssetChange={onAssetChange}
          compareAssets={compareAssets}
          onCompareToggle={onCompareToggle}
          marketFlags={marketFlags}
        />
      </div>

      <div
        ref={chartBoxRef}
        className="relative h-[68vh] min-h-[560px] w-full sm:min-h-[600px]"
      >
        {/* Keyboard twin of the crosshair. It holds no children (the chart's
            attribution link stays outside it) and lets pointer input through. */}
        <div
          tabIndex={0}
          role="slider"
          aria-label="Market tape date"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, navTimes.length - 1)}
          aria-valuenow={navIndex}
          aria-valuetext={sliderValueText}
          onKeyDown={handleSliderKeyDown}
          onFocus={handleSliderFocus}
          onBlur={handleSliderBlur}
          className={`pointer-events-none absolute inset-0 z-[15] rounded-2xl ${FOCUS_RING_INSET}`}
        />
        {/* The TradingView attribution (licence) sits above the edge fades so
            it stays legible and its focus ring is not covered. The right
            price-axis cell fades out just below the price area's foot
            (scaleMargins.bottom 0.32), so no % labels sit beside the ribbon. */}
        <div
          ref={containerRef}
          data-testid="regime-terminal-chart"
          className="absolute inset-0 [&_#tv-attr-logo]:z-20! [&_tr:first-child>td:last-child]:[mask-image:linear-gradient(to_bottom,#000_69%,transparent_72%)]"
        />

        <ChartCrosshairLegend
          point={displayPoint}
          asset={asset}
          isDark={isDark}
          active={crosshairActive}
          side={legendSide}
          room={chartWidth}
          rightInset={equityScaleWidth + 28}
          valueChars={assetValueChars}
          marketFlags={marketFlags}
        />

        {hoveredMetric && tooltipPlace ? (
          <div
            key={`${hoveredMetric.id}|${tooltipPlace.centre ? "centre" : legendSide}`}
            className={`pointer-events-none absolute top-4 z-20 flex justify-center sm-tall:translate-y-[var(--regime-card-drop,0px)] ${
              tooltipPlace.centre ? "left-1/2 -translate-x-1/2" : ""
            }`}
            style={
              tooltipPlace.centre
                ? undefined
                : { left: tooltipPlace.left, width: tooltipPlace.width }
            }
          >
            <div
              data-testid="crash-hover-tooltip"
              className="flex min-w-0 max-w-full items-center whitespace-nowrap rounded-full border border-black/[0.08] bg-white/[0.92] px-3.5 py-2 font-mono text-micro font-medium text-[#14121a] shadow-[0_24px_80px_rgba(20,18,26,0.18)] backdrop-blur-xl dark:border-white/10 dark:bg-[#0b0b12]/[0.92] dark:text-[#f2ede4] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
            >
              <span className="min-w-0 truncate">{hoveredMetric.name}</span>
              <span className="mx-2 text-black/25 dark:text-white/25" aria-hidden="true">|</span>
              <span className="shrink-0 text-[#c0442f] dark:text-[#ffb4a8]">
                {hoveredMetric.drawdown == null
                  ? "—"
                  : formatPercent(hoveredMetric.drawdown, 1)}
              </span>
              <span className="mx-2 text-black/25 dark:text-white/25" aria-hidden="true">|</span>
              <span
                className="shrink-0"
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
                    isDark,
                  ).color,
                }}
              >
                {formatSigned(hoveredMetric.score)}
              </span>
            </div>
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-[#f1ebe2] via-[#f1ebe2]/55 to-transparent dark:from-[#020204] dark:via-[#020204]/55 sm:w-20" />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-[#f1ebe2] via-[#f1ebe2]/55 to-transparent dark:from-[#020204] dark:via-[#020204]/55 sm:w-20"
          style={{ right: equityScaleWidth ? `${equityScaleWidth}px` : 0 }}
        />

        {/* The ribbon's scale. With market flags it sits just above their
            lanes at the plot's foot (6 px clear of the top lane), so no
            week's flag is ever hidden under it. */}
        <div
          className="pointer-events-none absolute bottom-8 left-14 z-20 hidden select-none items-baseline gap-2 rounded-full border border-black/5 bg-white/45 px-2.5 py-1 font-mono text-micro text-black/60 backdrop-blur-xl dark:border-white/5 dark:bg-black/35 dark:text-white/60 sm:flex"
          style={{
            bottom: marketFlags.length
              ? timeScaleHeight +
                FLAG_STRIP_INSET_PX +
                marketFlags.length * (FLAG_STRIP_PX + FLAG_STRIP_GAP_PX) +
                4
              : Math.max(12, timeScaleHeight - 8),
          }}
        >
          <span className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
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
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 text-micro text-black/60 dark:text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              {formatDate(coverage?.start)} → {formatDate(coverage?.end)} ·{" "}
              {crashes?.length ?? 0} NBER windows ·{" "}
              {resolution ? `${resolution} tape` : "macro tape"} · 0% at{" "}
              {/* Monospaced, so a new base date never changes its width. */}
              <span className="font-mono tabular-nums">{formatDate(zeroDate)}</span>
            </span>
            <span className="hidden text-black/20 dark:text-white/20 sm:inline">
              /
            </span>
            {/* The chart key: it wraps between keys, never inside one. */}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {RIBBON_KEY.map(([bucket, label]) => (
                <span
                  key={bucket}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: coreIndexTone(bucket, isDark).color }}
                  />
                  {label}
                </span>
              ))}
              {marketFlags.map((flag) => (
                <span
                  key={flag.field}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <span
                    className="h-0.5 w-3 rounded-full"
                    style={{ backgroundColor: isDark ? flag.dark : flag.light }}
                  />
                  {flag.label.toLowerCase()}
                </span>
              ))}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden sm:inline [@media(hover:none)]:hidden">
              Hover a red NBER band for drawdown + score · click to zoom.
            </span>
            <span className="hidden sm:[@media(hover:none)]:inline">
              Press and hold the chart to scrub
            </span>
            <label className="inline-flex items-center gap-1.5">
              <span className="sr-only">Jump to NBER recession window</span>
              <select
                value={selectedId ?? ""}
                onChange={(event) => {
                  const crash = (crashes ?? []).find(
                    (item) => item.id === event.target.value,
                  );
                  if (crash) {
                    openerRef.current = event.currentTarget;
                    onSelect?.(crash);
                  }
                }}
                className="max-w-[13rem] rounded-full border border-black/5 bg-white/45 px-2.5 py-1 font-sans text-micro text-black/60 focus:border-[#c0442f]/40 dark:border-white/5 dark:bg-black/30 dark:text-white/60"
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
