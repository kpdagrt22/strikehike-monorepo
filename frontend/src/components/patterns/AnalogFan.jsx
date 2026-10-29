"use client";

// The interactive instrument of section 01, loaded after the page (it is the
// bulk of the route's code): the outlook chart, its readout and the years.
// PeekIntoFuture shows a placeholder of the same geometry until it arrives.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { DUR, EASE, INTENT } from "@/lib/motion";
import {
  CHIP_GRID,
  CHIP_SLOT,
  FAN_BOX,
  MINUS,
  MIRROR_ROW,
  READOUT_BOX,
  STRIP_BOX,
  STRIP_ROW,
  closerThan,
  finite,
  firstEvent,
  formatChange,
  formatCount,
  formatDate,
  formatMonth,
  formatShare,
  horizonOf,
  mirrorExact,
  mirrorSourceTag,
  setupsLabel,
  sourceTag,
  windowLabel,
  yearOf,
} from "@/components/patterns/patternFormat";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// The editorial taglines, shown in the readouts.
const TODAY_TAGLINES = {
  sp500: "AI, ETFs and concentrated leadership",
  nifty: "Domestic flows, earnings and a valuation reset",
};
const MIRROR_TAGLINE = "Railroads, electricity and the road to 1907";

function monthParts(value) {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})/.exec(value) : null;
  const month = match ? Number(match[2]) : 0;
  return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : null;
}

/** "June 1985" (screen-reader descriptions) */
function formatMonthLong(value) {
  const p = monthParts(value);
  return p ? `${MONTHS_LONG[p.month - 1]} ${p.year}` : "—";
}

/** A chip label when two setups share a year: "Jun ’85". */
function formatMonthShort(value) {
  const p = monthParts(value);
  return p ? `${MONTHS[p.month - 1]} ’${String(p.year).slice(2)}` : "—";
}

/** A fall as a distance: "1.1%" (after "below its high"). */
function formatSize(value) {
  return finite(value) ? `${Math.abs(Number(value)).toFixed(1)}%` : "—";
}

function formatMultiple(value) {
  return finite(value) ? `${Number(value).toFixed(1)}×` : "—";
}

/** A path's change (its first point = 100) at fraction u of its length. */
function pathChangeAt(path, u) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const base = Number(path[0]?.value);
  if (!(base > 0)) return null;
  const position = Math.min(Math.max(u, 0), 1) * (path.length - 1);
  const low = Math.floor(position);
  const high = Math.min(low + 1, path.length - 1);
  const a = Number(path[low]?.value);
  const b = Number(path[high]?.value);
  if (!(a > 0) || !(b > 0)) return null;
  return ((a + (b - a) * (position - low)) / base - 1) * 100;
}

// Tangents for a monotone cubic through (xs[i], ys[i]) (Steffen, 1990): between
// two points the curve stays within their values, so a drawn peak or trough is
// the data's own, never an overshoot. A local copy of the /regime helper.
function monotoneTangents(xs, ys) {
  const count = xs.length;
  const tangents = new Float64Array(count);
  if (count < 2) return tangents;
  const slope = (i) => (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i] || 1e-9);
  let previous = slope(0);
  tangents[0] = previous;
  for (let i = 1; i < count - 1; i += 1) {
    const next = slope(i);
    const before = xs[i] - xs[i - 1];
    const after = xs[i + 1] - xs[i];
    const blend = (previous * after + next * before) / (before + after || 1e-9);
    tangents[i] =
      (Math.sign(previous) + Math.sign(next)) *
      Math.min(Math.abs(previous), Math.abs(next), 0.5 * Math.abs(blend));
    previous = next;
  }
  tangents[count - 1] = previous;
  return tangents;
}

const fixed = (value) => (Math.round(value * 10) / 10).toString();

/** SVG path data for the monotone curve, forwards ("M…") or backwards ("L…"). */
function monotonePath(xs, ys, tangents, backwards = false) {
  const count = xs.length;
  if (count === 0) return "";
  const start = backwards ? count - 1 : 0;
  const step = backwards ? -1 : 1;
  let d = `${backwards ? "L" : "M"}${fixed(xs[start])},${fixed(ys[start])}`;
  for (let i = start; i + step >= 0 && i + step < count; i += step) {
    const j = i + step;
    const third = (xs[j] - xs[i]) / 3;
    d += `C${fixed(xs[i] + third)},${fixed(ys[i] + tangents[i] * third)} ${fixed(xs[j] - third)},${fixed(ys[j] - tangents[j] * third)} ${fixed(xs[j])},${fixed(ys[j])}`;
  }
  return d;
}

/** The y of that curve at x, or null outside its points. */
function monotoneAt(xs, ys, tangents, x) {
  const count = xs.length;
  if (!(count > 0) || !(x >= xs[0]) || !(x <= xs[count - 1])) return null;
  if (count === 1) return ys[0];
  let low = 0;
  let high = count - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (xs[middle] <= x) low = middle;
    else high = middle;
  }
  const span = xs[high] - xs[low];
  if (!(span > 0)) return ys[low];
  const t = (x - xs[low]) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * ys[low] +
    (t3 - 2 * t2 + t) * span * tangents[low] +
    (3 * t2 - 2 * t3) * ys[high] +
    (t3 - t2) * span * tangents[high]
  );
}

const MARGIN = { top: 22, bottom: 26, left: 2 };
const SNAP_PX = 22;
const LABEL_GAP = 14;
const TICK_STEPS = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
const LOG_LEVELS = [0, -50, 100, -75, 300, -90, 900, 1900, 4900, 9900];
const UNFOLD_EASE = `cubic-bezier(${EASE.out.join(", ")})`;

// Setup lines: rest / lifted (pointer in the card, focus in the years) /
// touch, where nothing depends on hover. Dark first, then light.
const SETUP_ALPHA = {
  rest: [0.13, 0.12],
  lifted: [0.24, 0.22],
  touch: [0.18, 0.18],
  dimmed: [0.06, 0.06],
  few: [0.55, 0.55],
};

function rightGutter(width) {
  return width >= 600 ? 72 : 58;
}

// x is the fraction of the window, so weekly setups and the monthly mirror
// share one axis: a trailing path runs u = −1 → 0 and ends at today, a
// forward path runs u = 0 → 1. y is the log of the level rebased to today.
function toSeries(path, trailing) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const last = path.length - 1;
  const base = Number(path[trailing ? last : 0]?.value);
  if (!(base > 0)) return null;
  const us = [];
  const ys = [];
  path.forEach((point, index) => {
    const value = Number(point?.value);
    if (!(value > 0)) return;
    us.push(trailing ? index / last - 1 : index / last);
    ys.push(Math.log(value / base));
  });
  return us.length >= 2 ? { us, ys } : null;
}

function toCurve(series, X, Y) {
  if (!series) return null;
  const xs = series.us.map(X);
  const ys = series.ys.map(Y);
  const tangents = monotoneTangents(xs, ys);
  return { xs, ys, tangents, d: monotonePath(xs, ys, tangents) };
}

function curveY(curve, x) {
  return curve ? monotoneAt(curve.xs, curve.ys, curve.tangents, x) : null;
}

function endY(curve) {
  return curve ? curve.ys[curve.ys.length - 1] : null;
}

function percentTick(change) {
  if (change === 0) return "0%";
  return `${change > 0 ? "+" : MINUS}${Math.abs(change)}%`;
}

// Everything drawable is in the domain (every setup's own year included), so
// a selection never rescales the chart.
function buildChart(engine, width, height) {
  if (!engine || !(width > 0) || !(height > 0)) return null;
  const outlook = engine.status === "insufficient" ? null : engine.outlook;
  const exact = engine.mirror?.available === true ? engine.mirror.exact : null;
  const raw = {
    today: toSeries(engine.current?.path, true),
    median: outlook ? toSeries(outlook.median_path, false) : null,
    q25: outlook ? toSeries(outlook.usual_paths?.q25, false) : null,
    q50: outlook ? toSeries(outlook.usual_paths?.q50, false) : null,
    q75: outlook ? toSeries(outlook.usual_paths?.q75, false) : null,
    mirrorBack: exact ? toSeries(exact.window?.path, true) : null,
    mirrorForward: exact ? toSeries(exact.forward?.path, false) : null,
  };
  const setups = (engine.analogs ?? []).map((analog) => ({
    analog,
    back: toSeries(analog?.window?.path, true),
    forward: toSeries(analog?.forward?.path, false),
  }));

  let low = 0;
  let high = 0;
  const extend = (series) => {
    if (!series) return;
    for (const y of series.ys) {
      if (y < low) low = y;
      if (y > high) high = y;
    }
  };
  Object.values(raw).forEach(extend);
  setups.forEach((setup) => {
    extend(setup.back);
    extend(setup.forward);
  });
  const pad = (high - low) * 0.06 || 0.05;
  low -= pad;
  high += pad;

  const right = rightGutter(width);
  const plotWidth = Math.max(1, width - MARGIN.left - right);
  const plotHeight = Math.max(1, height - MARGIN.top - MARGIN.bottom);
  const X = (u) => MARGIN.left + ((u + 1) / 2) * plotWidth;
  const Y = (y) => MARGIN.top + ((high - y) / (high - low)) * plotHeight;

  const minGap = width >= 600 ? 34 : 28;
  let ticks = [0];
  for (const step of TICK_STEPS) {
    const candidates = [];
    for (let change = -step * Math.floor(99 / step); change <= 5000; change += step) {
      const y = Math.log1p(change / 100);
      if (y > low && y < high) candidates.push(change);
    }
    const spaced = candidates.every(
      (change, index) =>
        index === 0 ||
        Math.abs(Y(Math.log1p(change / 100)) - Y(Math.log1p(candidates[index - 1] / 100))) >= minGap,
    );
    if (candidates.length > 0 && spaced) {
      ticks = candidates;
      break;
    }
  }
  if (ticks.length === 1) {
    // Ranges too wide for even steps (a log axis): multiplicative levels,
    // 0% first, each kept only if it clears the others.
    ticks = [];
    for (const change of LOG_LEVELS) {
      const y = Y(Math.log1p(change / 100));
      const inside = Math.log1p(change / 100) > low && Math.log1p(change / 100) < high;
      if (inside && ticks.every((placed) => Math.abs(Y(Math.log1p(placed / 100)) - y) >= minGap)) {
        ticks.push(change);
      }
    }
    ticks.sort((a, b) => a - b);
  }

  const curves = {
    today: toCurve(raw.today, X, Y),
    median: toCurve(raw.median, X, Y),
    q25: toCurve(raw.q25, X, Y),
    q50: toCurve(raw.q50, X, Y),
    q75: toCurve(raw.q75, X, Y),
    mirrorBack: toCurve(raw.mirrorBack, X, Y),
    mirrorForward: toCurve(raw.mirrorForward, X, Y),
  };
  const band =
    curves.q75 && curves.q25
      ? `${curves.q75.d}${monotonePath(curves.q25.xs, curves.q25.ys, curves.q25.tangents, true)}Z`
      : null;

  return {
    width,
    height,
    plotWidth,
    plotHeight,
    right,
    X,
    Y,
    ticks: ticks.map((change) => ({ change, y: Y(Math.log1p(change / 100)), text: percentTick(change) })),
    curves,
    band,
    setups: setups.map((setup) => ({
      rank: setup.analog?.rank,
      forwardEnd: setup.analog?.forward?.end,
      back: toCurve(setup.back, X, Y),
      forward: toCurve(setup.forward, X, Y),
    })),
    mirrorEnd: exact?.forward?.end ?? null,
    zeroY: Y(0),
  };
}

function sameTarget(a, b) {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.rank === b.rank && a.m === b.m;
}

// Where the crosshair sits for a selection: chips select a whole year (+12).
function selectionU(active) {
  if (!active) return null;
  if (active.kind === "today") return active.m ? -active.m / 12 : null;
  if (active.kind === "median") return (active.m ?? 12) / 12;
  return (active.m ?? 12) / 12;
}

function placeLabels(items, top, bottom) {
  const placed = items
    .filter((item) => Number.isFinite(item.y))
    .map((item) => ({ ...item }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < placed.length; i += 1) {
    if (placed[i].y - placed[i - 1].y < LABEL_GAP) placed[i].y = placed[i - 1].y + LABEL_GAP;
  }
  for (let i = placed.length - 1; i >= 0; i -= 1) {
    const ceiling = i === placed.length - 1 ? bottom : placed[i + 1].y - LABEL_GAP;
    placed[i].y = Math.min(placed[i].y, ceiling);
  }
  for (let i = 0; i < placed.length; i += 1) {
    placed[i].y = Math.max(placed[i].y, i === 0 ? top : placed[i - 1].y + LABEL_GAP);
  }
  return placed;
}

/**
 * The outlook chart: today's 12 months on the left, the 12 months after each
 * past setup on the right, the usual year behind them. Hover, focus and tap
 * select through `onHover` / `onPick`; the readout lives outside the chart.
 */
export function AnalogFan({
  engine,
  active,
  engaged,
  coarse,
  isDark,
  label,
  onHover,
  onPick,
}) {
  const wrapRef = useRef(null);
  const clipRef = useRef(null);
  const frameRef = useRef(0);
  const lastRef = useRef(null);
  const pointerTypeRef = useRef("mouse");
  const unfoldedRef = useRef(null);
  const clipId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    // The observer reports the first size on its own; the height comes from
    // CSS breakpoints, so the frame never shifts when the chart arrives.
    const observer = new ResizeObserver(() => {
      const width = Math.round(node.clientWidth);
      const height = Math.round(node.clientHeight);
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const chart = useMemo(
    () => buildChart(engine, size.width, size.height),
    [engine, size.width, size.height],
  );

  // One unfold of the future, from the Today divider, each time data arrives.
  useLayoutEffect(() => {
    if (!engine || !chart || unfoldedRef.current === engine) return undefined;
    unfoldedRef.current = engine;
    const rect = clipRef.current;
    if (reducedMotion || !rect || typeof rect.animate !== "function") return undefined;
    const animation = rect.animate(
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: DUR.data * 1000, easing: UNFOLD_EASE },
    );
    return () => animation.cancel();
  }, [engine, chart, reducedMotion]);

  const targetAt = (clientX, clientY) => {
    const node = wrapRef.current;
    if (!chart || !node) return null;
    const box = node.getBoundingClientRect();
    const px = clientX - box.left;
    const py = clientY - box.top;
    const u = Math.max(-1, Math.min(1, ((px - MARGIN.left) / chart.plotWidth) * 2 - 1));
    const m = Math.round(Math.abs(u) * 12);
    if (u <= 0 || m === 0) return { kind: "today", m };
    const x = chart.X(m / 12);
    const candidates = [];
    if (chart.curves.median) candidates.push({ kind: "median", m, y: curveY(chart.curves.median, x) });
    if (chart.curves.mirrorForward) {
      candidates.push({ kind: "mirror", m, y: curveY(chart.curves.mirrorForward, x) });
    }
    chart.setups.forEach((setup) => {
      if (setup.forward) candidates.push({ kind: "setup", rank: setup.rank, m, y: curveY(setup.forward, x) });
    });
    let best = null;
    let distance = Infinity;
    candidates.forEach((candidate) => {
      if (!Number.isFinite(candidate.y)) return;
      const gap = Math.abs(candidate.y - py);
      if (gap < distance) {
        best = candidate;
        distance = gap;
      }
    });
    if (!best) return null;
    if (distance > SNAP_PX && chart.curves.median) return { kind: "median", m };
    return best.kind === "setup" ? { kind: "setup", rank: best.rank, m } : { kind: best.kind, m };
  };

  const handlePointerMove = (event) => {
    if (event.pointerType !== "mouse") return;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const target = targetAt(clientX, clientY);
      if (target && !sameTarget(target, lastRef.current)) {
        lastRef.current = target;
        onHover(target);
      }
    });
  };

  const handlePointerLeave = (event) => {
    if (event.pointerType !== "mouse") return;
    cancelAnimationFrame(frameRef.current);
    lastRef.current = null;
    onHover(null);
  };

  const handleClick = (event) => {
    const target = targetAt(event.clientX, event.clientY);
    if (target) onPick(target, pointerTypeRef.current);
  };

  const darkIndex = isDark ? 0 : 1;
  const selectedRank = active?.kind === "setup" ? active.rank : null;
  const mirrorSelected = active?.kind === "mirror";
  const todaySelected = active?.kind === "today";
  const focused = selectedRank != null || mirrorSelected;
  const few = engine?.status === "insufficient";
  const setupAlpha = few
    ? SETUP_ALPHA.few[darkIndex]
    : focused
      ? SETUP_ALPHA.dimmed[darkIndex]
      : engaged
        ? SETUP_ALPHA.lifted[darkIndex]
        : coarse
          ? SETUP_ALPHA.touch[darkIndex]
          : SETUP_ALPHA.rest[darkIndex];
  const selectedSetup =
    selectedRank != null && chart
      ? chart.setups.find((setup) => setup.rank === selectedRank) ?? null
      : null;

  let crosshair = null;
  const u = selectionU(active);
  if (chart && u != null) {
    const x = chart.X(u);
    const curve =
      active.kind === "today"
        ? chart.curves.today
        : active.kind === "median"
          ? chart.curves.median
          : active.kind === "mirror"
            ? chart.curves.mirrorForward
            : selectedSetup?.forward;
    const y = curveY(curve, x);
    crosshair = {
      x,
      y,
      tone:
        active.kind === "mirror"
          ? "fill-(--fan-gold)"
          : active.kind === "setup"
            ? "fill-(--sh-text-1)"
            : "fill-(--fan-accent)",
    };
  }

  const labels = chart
    ? placeLabels(
        [
          { key: "median", y: endY(chart.curves.median), text: "median", swatch: "median" },
          { key: "usual", y: endY(chart.curves.q50), text: "usual", swatch: "usual" },
          chart.curves.mirrorForward
            ? { key: "mirror", y: endY(chart.curves.mirrorForward), text: String(yearOf(chart.mirrorEnd) ?? ""), swatch: "mirror" }
            : null,
          selectedSetup?.forward
            ? { key: "selected", y: endY(selectedSetup.forward), text: String(yearOf(selectedSetup.forwardEnd) ?? ""), swatch: "selected" }
            : null,
        ].filter(Boolean),
        MARGIN.top + 4,
        MARGIN.top + (chart?.plotHeight ?? 0),
      )
    : [];

  const width = chart?.width ?? size.width;
  const height = chart?.height ?? size.height;
  const right = rightGutter(width);
  const plotRight = width - right;
  const plotBottom = height - MARGIN.bottom;
  const dividerX = MARGIN.left + (plotRight - MARGIN.left) / 2;

  return (
    <div ref={wrapRef} className={`${FAN_BOX} touch-pan-y select-none`}>
      {width > 0 && height > 0 ? (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block overflow-visible"
          role={chart ? "img" : undefined}
          aria-label={chart ? label : undefined}
          aria-hidden={chart ? undefined : true}
        >
          <defs>
            <clipPath id={clipId}>
              <rect
                ref={clipRef}
                x={dividerX}
                y={0}
                width={Math.max(0, width - dividerX)}
                height={height}
                style={{ transformBox: "fill-box", transformOrigin: "left center" }}
              />
            </clipPath>
          </defs>

          {chart
            ? chart.ticks.map((tick) => (
                <line
                  key={`grid-${tick.change}`}
                  x1={MARGIN.left}
                  x2={plotRight}
                  y1={tick.y}
                  y2={tick.y}
                  className={tick.change === 0 ? "stroke-(--sh-line-2)" : "stroke-(--sh-line-1)"}
                />
              ))
            : (
                <line
                  x1={MARGIN.left}
                  x2={plotRight}
                  y1={MARGIN.top + (plotBottom - MARGIN.top) * 0.55}
                  y2={MARGIN.top + (plotBottom - MARGIN.top) * 0.55}
                  className="stroke-(--sh-line-2)"
                />
              )}

          <line
            x1={dividerX}
            x2={dividerX}
            y1={MARGIN.top - 8}
            y2={plotBottom}
            className="stroke-(--sh-line-2)"
          />
          <text
            x={dividerX}
            y={MARGIN.top - 12}
            textAnchor="middle"
            className="fill-(--sh-text-3) font-mono text-[11px]"
          >
            Today
          </text>

          {chart ? (
            <>
              {selectedSetup?.back ? (
                <path
                  d={selectedSetup.back.d}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                  strokeLinecap="round"
                  className="stroke-(--sh-text-1)"
                />
              ) : null}
              {mirrorSelected && chart.curves.mirrorBack ? (
                <path
                  d={chart.curves.mirrorBack.d}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                  strokeLinecap="round"
                  className="stroke-(--fan-gold)"
                />
              ) : null}
              {chart.curves.today ? (
                <path
                  d={chart.curves.today.d}
                  fill="none"
                  strokeWidth={todaySelected ? 2.5 : 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="stroke-(--fan-accent)"
                />
              ) : null}

              <g clipPath={`url(#${clipId})`}>
                {chart.band ? (
                  <path
                    d={chart.band}
                    className="fill-(--fan-ink)"
                    style={{ fillOpacity: focused ? 0.035 : 0.06 }}
                  />
                ) : null}
                {chart.setups.map((setup) =>
                  setup.forward && setup.rank !== selectedRank ? (
                    <path
                      key={`setup-${setup.rank}`}
                      d={setup.forward.d}
                      fill="none"
                      strokeWidth={1}
                      strokeLinecap="round"
                      className="stroke-(--fan-ink) transition-[stroke-opacity] duration-(--sh-dur-micro) ease-(--sh-ease-out) motion-reduce:transition-none"
                      style={{ strokeOpacity: setupAlpha }}
                    />
                  ) : null,
                )}
                {chart.curves.q50 ? (
                  <path
                    d={chart.curves.q50.d}
                    fill="none"
                    strokeWidth={1.25}
                    strokeDasharray="0.1 4"
                    strokeLinecap="round"
                    className="stroke-(--sh-text-2)"
                    style={{ strokeOpacity: focused ? 0.5 : 1 }}
                  />
                ) : null}
                {chart.curves.mirrorForward ? (
                  <path
                    d={chart.curves.mirrorForward.d}
                    fill="none"
                    strokeWidth={mirrorSelected ? 2.25 : 1.5}
                    strokeLinecap="round"
                    className="stroke-(--fan-gold)"
                    style={{ strokeOpacity: mirrorSelected ? 1 : focused ? 0.35 : 0.75 }}
                  />
                ) : null}
                {chart.curves.median ? (
                  <path
                    d={chart.curves.median.d}
                    fill="none"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    strokeLinecap="round"
                    className="stroke-(--fan-accent)"
                    style={{ strokeOpacity: focused ? 0.5 : 1 }}
                  />
                ) : null}
                {selectedSetup?.forward ? (
                  <path
                    d={selectedSetup.forward.d}
                    fill="none"
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    className="stroke-(--sh-text-1)"
                  />
                ) : null}
                {labels.map((item) => {
                  const x = chart.X(1) + 6;
                  return (
                    <g key={`label-${item.key}`}>
                      <line
                        x1={x}
                        x2={x + 9}
                        y1={item.y}
                        y2={item.y}
                        strokeWidth={item.swatch === "usual" ? 1.5 : 2}
                        strokeDasharray={
                          item.swatch === "median" ? "4 2" : item.swatch === "usual" ? "0.1 3" : undefined
                        }
                        strokeLinecap={item.swatch === "usual" ? "round" : undefined}
                        className={
                          item.swatch === "median"
                            ? "stroke-(--fan-accent)"
                            : item.swatch === "usual"
                              ? "stroke-(--sh-text-2)"
                              : item.swatch === "mirror"
                                ? "stroke-(--fan-gold)"
                                : "stroke-(--sh-text-1)"
                        }
                      />
                      <text
                        x={x + 13}
                        y={item.y + 4}
                        className={`font-mono text-[11px] ${
                          item.swatch === "selected" ? "fill-(--sh-text-1)" : "fill-(--sh-text-2)"
                        }`}
                      >
                        {item.text}
                      </text>
                    </g>
                  );
                })}
              </g>

              {chart.curves.today ? (
                <circle
                  cx={chart.X(0)}
                  cy={chart.zeroY}
                  r={4}
                  strokeWidth={2}
                  className="fill-(--fan-accent) stroke-(--fan-surface)"
                />
              ) : null}

              {crosshair ? (
                <>
                  <line
                    x1={crosshair.x}
                    x2={crosshair.x}
                    y1={MARGIN.top}
                    y2={plotBottom}
                    className="stroke-(--sh-line-2)"
                  />
                  {Number.isFinite(crosshair.y) ? (
                    <circle
                      cx={crosshair.x}
                      cy={crosshair.y}
                      r={3.5}
                      strokeWidth={2}
                      className={`${crosshair.tone} stroke-(--fan-surface)`}
                    />
                  ) : null}
                </>
              ) : null}

              {chart.ticks.map((tick) => (
                <text
                  key={`tick-${tick.change}`}
                  x={MARGIN.left + 2}
                  y={tick.y - 5}
                  strokeWidth={3}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  className="fill-(--sh-text-3) stroke-(--fan-surface) font-mono text-[11px]"
                >
                  {tick.text}
                </text>
              ))}
            </>
          ) : null}

          {chart ? (
            <g className="fill-(--sh-text-3) font-mono text-[11px]">
              <text x={MARGIN.left} y={plotBottom + 17}>
                {formatMonth(engine.current?.start)}
              </text>
              {[3, 6, 12].map((months) => {
                const x = chart.X(months / 12);
                return (
                  <g key={`axis-${months}`}>
                    <line x1={x} x2={x} y1={plotBottom} y2={plotBottom + 4} className="stroke-(--sh-line-2)" />
                    {months === 3 && width < 600 ? null : (
                      <text x={x} y={plotBottom + 17} textAnchor={months === 12 ? "end" : "middle"}>
                        +{months} mo
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ) : null}

          {chart ? (
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={chart.plotWidth}
              height={chart.plotHeight}
              fill="transparent"
              onPointerDown={(event) => {
                pointerTypeRef.current = event.pointerType || "mouse";
              }}
              onPointerEnter={() => {
                lastRef.current = null;
              }}
              onPointerMove={handlePointerMove}
              onPointerLeave={handlePointerLeave}
              onClick={handleClick}
            />
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}

const HOVER_NONE = "(hover: none)";

function subscribeHoverNone(onChange) {
  const query = window.matchMedia(HOVER_NONE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getHoverNone = () => window.matchMedia(HOVER_NONE).matches;
const getHoverNoneOnServer = () => false;

// chartM: the keyboard position on the chart, in months (−12 … 0 on today’s
// line, 1 … 12 after the setups). It starts at Today, the chart’s centre.
const EMPTY = { hover: null, pinned: null, focusIndex: 0, chartM: 0 };
const CHART_MONTHS = 12;
const CHART_STEPS = { __proto__: null, ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 3, PageDown: -3 };

function sameItem(a, b) {
  return Boolean(a && b && a.kind === b.kind && a.rank === b.rank);
}

/** A keyboard position as a chart target, the same targets hover gives. */
function chartTarget(value) {
  return value <= 0 ? { kind: "today", m: -value } : { kind: "median", m: value };
}

function samePlace(a, b) {
  return Boolean(a && b && a.kind === b.kind && a.rank === b.rank && a.m === b.m);
}

// What the Today and median readouts state, shared by the readout and the
// keyboard slider's value text so the two never drift apart.
function todayFacts(engine) {
  const current = engine.current ?? {};
  return {
    start: formatMonth(current.start),
    end: formatDate(engine.as_of),
    tagline: TODAY_TAGLINES[engine.asset] ?? null,
    change: formatChange(current.return_pct),
    // null: at its 12-month high
    below: Number(current.drawdown_pct) > -0.05 ? null : formatSize(current.drawdown_pct),
    vol: formatMultiple(current.vol_vs_10y),
  };
}

function todaySentence(today) {
  return `${today.below == null ? "at its 12-month high" : `${today.below} below its high`}, volatility ${today.vol} its 10-year median`;
}

// Counts appear only where their usual share exists (3, 6, 12 months);
// between them the median and the usual median are shown.
function medianFacts(engine, m) {
  const horizon = horizonOf(engine, m);
  if (horizon) {
    return {
      median: formatChange(horizon.median_return_pct),
      usual: formatChange(horizon.base_median_return_pct),
      higher: `${horizon.higher} of ${horizon.of}`,
      share: formatShare(horizon.base_share_up_pct),
    };
  }
  const outlook = engine.outlook;
  return {
    median: formatChange(pathChangeAt(outlook?.median_path, m / 12)),
    usual: formatChange(pathChangeAt(outlook?.usual_paths?.q50, m / 12)),
  };
}

const monthsWord = (m) => `${m} ${m === 1 ? "month" : "months"}`;

/** The slider's aria-valuetext: the readout that position shows, as a sentence. */
function positionText(engine, value) {
  if (!engine) return "";
  if (value <= 0) {
    const today = todayFacts(engine);
    return `${value < 0 ? `${monthsWord(-value)} before today. ` : ""}Today, ${today.start} to ${today.end}${
      today.tagline ? `: ${today.tagline}` : ""
    }. Past 12 months ${today.change}, ${todaySentence(today)}.`;
  }
  const outlook = engine.status === "insufficient" ? null : engine.outlook;
  const k = outlook?.k ?? engine.analogs?.length ?? 0;
  if (!outlook) return `${setupsLabel(k, false)}: each is drawn above; too few for a median.`;
  const facts = medianFacts(engine, value);
  return `Median of the ${k} setups, ${monthsWord(value)} after: ${facts.median}, usual ${facts.usual}${
    facts.higher ? `; ${facts.higher} higher, usual ${facts.share}` : ""
  }.`;
}

function Value({ children, strong = false }) {
  return (
    <span
      className={`font-mono tabular-nums ${
        strong
          ? "text-strong text-[#14121a] dark:text-[#f2ede4]"
          : "text-(--sh-text-1)"
      }`}
    >
      {children}
    </span>
  );
}

function Pair({ label, children, strong, after }) {
  return (
    <span>
      {label ? <span className="text-(--sh-text-3)">{label} </span> : null}
      <Value strong={strong}>{children}</Value>
      {after ? <span> {after}</span> : null}
    </span>
  );
}

// "The next year included {case}": the case catalogue's declines on this
// market that a setup's or the mirror's following 12 months took part in
// (rules in PatternCompare, whose small module and the catalogue load once
// the page is idle). null until then.
function useNextYear(engine) {
  const [found, setFound] = useState({ engine: null, lines: null });
  useEffect(() => {
    if (!engine) return undefined;
    let live = true;
    let stop = null;
    import("@/components/patterns/PatternCompare")
      .then((mod) => {
        if (live) stop = mod.watchNextYearLines(engine, (lines) => setFound({ engine, lines }));
      })
      .catch(() => {});
    return () => {
      live = false;
      stop?.();
    };
  }, [engine]);
  return found.engine === engine ? found.lines : null;
}

function NextYearLine({ line }) {
  return (
    <>
      {line.lead} <span className="text-(--sh-text-1)">the {line.name}</span>{" "}
      <span className="whitespace-nowrap font-mono tabular-nums">{line.detail}</span>
      {line.more > 0 ? ` +${line.more} more` : null}
    </>
  );
}

/**
 * The line under the years for the year in view: from 640 px it has its own
 * reserved line (in STRIP_BOX's padding, 8 px under the years; a longer line
 * would run into the card's padding, never move anything) and follows hover,
 * focus and tap; below 640 px it follows a tapped (pinned) year only and
 * takes its room in the flow, so it never moves the years above it and only
 * ever moves what is below on a press. Each year's description already
 * carries the sentence.
 */
function NextYearRow({ nextYear, active, pinned }) {
  const lineOf = (item) =>
    item?.kind === "mirror"
      ? nextYear?.get("mirror")
      : item?.kind === "setup"
        ? nextYear?.get(`setup:${item.rank}`)
        : null;
  const wide = lineOf(active);
  const narrow = lineOf(pinned);
  const key = (item) => `${item?.kind}-${item?.rank ?? ""}`;
  return (
    <>
      <p
        data-next-year=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[calc(100%-1rem)] text-micro leading-[1.35] text-(--sh-text-3) max-sm:hidden lg:top-[calc(100%-1.0625rem)]"
      >
        {wide ? (
          <span key={key(active)}>
            <NextYearLine line={wide} />
          </span>
        ) : null}
      </p>
      {narrow ? (
        <p
          key={key(pinned)}
          data-next-year=""
          aria-hidden="true"
          className="mt-2 text-micro leading-[1.35] text-(--sh-text-3) sm:hidden"
        >
          <NextYearLine line={narrow} />
        </p>
      ) : null}
    </>
  );
}

// The forward numbers of one past year (a setup or the mirror) and its first
// event: Financial first, then Geopolitics, then Science.
function YearValues({ item }) {
  const forward = item.forward ?? {};
  const event = firstEvent(item.events);
  const more = (item.events?.length ?? 0) - 1;
  return (
    <>
      <Pair label="Its past 12 months">{formatChange(item.window?.return_pct)}</Pair>
      <Pair label="next 3 months">{formatChange(forward.return_3m_pct)}</Pair>
      <Pair label="6 months">{formatChange(forward.return_6m_pct)}</Pair>
      <Pair label="12 months" strong>
        {formatChange(forward.return_12m_pct)}
      </Pair>
      <Pair label="worst fall">{formatChange(forward.max_drawdown_pct)}</Pair>
      {event ? (
        <span className="max-sm:max-w-full max-sm:truncate">
          <span className="font-mono tabular-nums text-(--sh-text-3)">
            {formatDate(event.date)}
          </span>{" "}
          <span className="text-(--sh-text-1)">{event.title}</span>
          {more > 0 ? <span className="text-(--sh-text-3)"> +{more} more</span> : null}
        </span>
      ) : null}
    </>
  );
}

function Readout({ engine, status, active }) {
  let first = null;
  let second = null;
  const who = (text) => (
    <span className="font-mono text-meta uppercase tracking-[0.04em] text-(--sh-text-1)">
      {text}
    </span>
  );

  if (!engine) {
    first = status === "error" ? "Archive unavailable" : "Reading archive";
    second = status === "error" ? "—" : " ";
  } else if (status === "switching") {
    first = "Reading archive";
    second = " ";
  } else {
    const outlook = engine.status === "insufficient" ? null : engine.outlook;
    const k = outlook?.k ?? engine.analogs?.length ?? 0;
    const kind = active?.kind ?? "median";
    if (kind === "today") {
      const today = todayFacts(engine);
      first = (
        <>
          {who("Today")}
          <span className="font-mono tabular-nums">
            {today.start} → {today.end}
          </span>
          {today.tagline ? <span>{today.tagline}</span> : null}
        </>
      );
      second = (
        <>
          <Pair label="Past 12 months" strong>
            {today.change}
          </Pair>
          {today.below == null ? (
            <span>at its 12-month high</span>
          ) : (
            <span>
              <Value>{today.below}</Value> below its high
            </span>
          )}
          <Pair label="volatility" after="its 10-year median">
            {today.vol}
          </Pair>
        </>
      );
    } else if (kind === "setup" || kind === "mirror") {
      const exact = mirrorExact(engine);
      const item =
        kind === "mirror"
          ? exact
          : engine.analogs?.find((analog) => analog.rank === active.rank);
      if (item && kind === "mirror") {
        const tag = mirrorSourceTag(item.window?.end);
        first = (
          <>
            <span
              className="inline-block w-3 -translate-y-[3px] border-t-2 border-(--fan-gold)"
              aria-hidden="true"
            />
            {who("Exactly 120 years ago")}
            <span className="font-mono tabular-nums">{formatMonth(item.window?.end)}</span>
            {/* Phones keep the readout within its reserved height: the line
                above the chart states "closer than", and section 02's
                Geopolitics & science carries the tagline's story. The source
                tag always shows: the mirror is a different, smoothed series. */}
            <span className="max-sm:hidden">
              closer than {closerThan(item.closer_than_pct)} of past 12-month windows
            </span>
            {tag ? <span>{tag}</span> : null}
            {yearOf(item.window?.end) === 1906 ? (
              <span className="max-sm:hidden">{MIRROR_TAGLINE}</span>
            ) : null}
          </>
        );
        second = <YearValues item={item} />;
      } else if (item) {
        const tag = sourceTag(item.source);
        first = (
          <>
            {who(formatMonth(item.window?.end))}
            <span>
              #{formatCount(item.position)} of {formatCount(item.of)} past{" "}
              {windowLabel(engine)} windows
            </span>
            {tag ? <span>{tag}</span> : null}
          </>
        );
        second = <YearValues item={item} />;
      }
    }
    if (first == null && !outlook) {
      first = (
        <>
          {who(setupsLabel(k, false))}
          <span>each is drawn above; too few for a median</span>
        </>
      );
      second = " ";
    } else if (first == null) {
      const m = kind === "median" && active?.m ? active.m : 12;
      const facts = medianFacts(engine, m);
      first = (
        <>
          {who(`Median of the ${k} setups`)}
          <span>{monthsWord(m)} after</span>
        </>
      );
      second = (
        <>
          <Pair strong>{facts.median}</Pair>
          <Pair label="usual">{facts.usual}</Pair>
          {facts.higher ? (
            <>
              <Pair after="higher">{facts.higher}</Pair>
              <Pair label="usual">{facts.share}</Pair>
            </>
          ) : null}
        </>
      );
    }
  }

  // New lines for each selection: content swapped in place would count as
  // layout shift on hover (hover is not an input); new nodes do not.
  const key = engine
    ? `${status}-${active?.kind ?? "rest"}-${active?.rank ?? ""}-${active?.m ?? ""}`
    : status;
  return (
    <div data-pattern-readout="" className={READOUT_BOX}>
      <p
        key={`${key}-a`}
        className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-micro text-(--sh-text-3)"
      >
        {first}
      </p>
      <p
        key={`${key}-b`}
        className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-meta text-(--sh-text-2) sm:gap-x-4"
      >
        {second}
      </p>
    </div>
  );
}

function chipItems(engine, nextYear) {
  if (!engine) return [];
  const included = (key) => (nextYear?.get(key) ? ` ${nextYear.get(key).text}` : "");
  const setups = [...(engine.analogs ?? [])].sort((a, b) =>
    String(a.window?.end).localeCompare(String(b.window?.end)),
  );
  const perYear = new Map();
  setups.forEach((analog) => {
    const year = yearOf(analog.window?.end);
    perYear.set(year, (perYear.get(year) ?? 0) + 1);
  });
  const items = setups.map((analog) => ({
    kind: "setup",
    rank: analog.rank,
    label:
      perYear.get(yearOf(analog.window?.end)) > 1
        ? formatMonthShort(analog.window?.end)
        : String(yearOf(analog.window?.end) ?? "—"),
    outcome: formatChange(analog.forward?.return_12m_pct),
    description: `${formatMonthLong(analog.window?.end)}: number ${formatCount(analog.position)} of ${formatCount(analog.of)} past windows; next 12 months ${formatChange(analog.forward?.return_12m_pct)}, worst fall ${formatChange(analog.forward?.max_drawdown_pct)}.${included(`setup:${analog.rank}`)}`,
  }));
  const exact = mirrorExact(engine);
  if (exact) {
    items.push({
      kind: "mirror",
      label: String(yearOf(exact.window?.end) ?? "—"),
      outcome: formatChange(exact.forward?.return_12m_pct),
      description: `120-year mirror, ${formatMonthLong(exact.window?.end)}: closer than ${closerThan(exact.closer_than_pct)} of past 12-month windows; next 12 months ${formatChange(exact.forward?.return_12m_pct)}, worst fall ${formatChange(exact.forward?.max_drawdown_pct)}.${included("mirror")}`,
    });
  }
  return items;
}

function chartLabel(engine, assetLabel) {
  if (!engine) return "";
  const k = engine.analogs?.length ?? 0;
  const exact = mirrorExact(engine);
  const mirror = exact
    ? ` The 120-year mirror, ${formatMonth(exact.window?.end)}, ${formatChange(exact.forward?.return_12m_pct)}.`
    : "";
  const today = todayFacts(engine);
  const now = ` Today’s past 12 months ${today.change}, ${todaySentence(today)}.`;
  if (engine.status === "insufficient" || !engine.outlook) {
    return `Outlook chart: the ${assetLabel} over the past 12 months, then the 12 months after ${k === 1 ? "the only past setup found" : `each of only ${k} past setups found`}.${now}${mirror}`;
  }
  const twelve = horizonOf(engine, 12);
  const q25 = pathChangeAt(engine.outlook.usual_paths?.q25, 1);
  const q75 = pathChangeAt(engine.outlook.usual_paths?.q75, 1);
  return `Outlook chart: the ${assetLabel} over the past 12 months, then the 12 months after each of the ${engine.outlook.k} closest setups. Their median ${formatChange(twelve?.median_return_pct)}; usual ${formatChange(twelve?.base_median_return_pct)}, usual middle half ${formatChange(q25)} to ${formatChange(q75)}.${now}${mirror}`;
}

function SetupChip({
  item,
  index,
  mirror = false,
  tabbable,
  selected,
  pinned,
  engaged,
  onEnter,
  onLeave,
  onFocusVisible,
  onFocusOther,
  onPress,
  onKeyDown,
}) {
  const descriptionId = `pattern-chip-${mirror ? "mirror" : item.rank}`;
  return (
    <button
      type="button"
      data-chip=""
      data-index={index}
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={pinned}
      aria-describedby={descriptionId}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") onEnter();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") onLeave();
      }}
      onFocus={(event) => {
        // Keyboard focus reveals like hover; a tap or click only pins.
        if (event.currentTarget.matches(":focus-visible")) onFocusVisible();
        else onFocusOther();
      }}
      onClick={onPress}
      onKeyDown={onKeyDown}
      className={`relative inline-flex ${CHIP_SLOT} flex-col items-center justify-center rounded-xl px-2 py-1 transition-colors duration-(--sh-dur-micro) hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) motion-reduce:transition-none after:absolute after:inset-x-[30%] after:bottom-[3px] after:h-0.5 after:rounded-full after:content-[''] ${
        pinned ? "bg-(--sh-hover)" : ""
      } ${
        selected
          ? `text-[#14121a] dark:text-[#f2ede4] ${mirror ? "after:bg-(--fan-gold)" : "after:bg-(--fan-accent)"}`
          : "text-(--sh-text-2) after:bg-transparent"
      }`}
    >
      <span className="inline-flex items-center gap-1.5 font-mono text-meta leading-tight tabular-nums">
        {mirror ? (
          <span className="inline-block w-2.5 border-t-2 border-(--fan-gold)" aria-hidden="true" />
        ) : null}
        {item.label}
      </span>
      <span
        className={`font-mono text-micro leading-tight tabular-nums text-(--sh-text-3) transition-opacity duration-(--sh-dur-reveal) ease-(--sh-ease-out) motion-reduce:transition-none [@media(hover:none)]:opacity-100 ${
          engaged ? "opacity-100" : "opacity-0"
        }`}
      >
        {item.outcome}
      </span>
      <span id={descriptionId} hidden>
        {item.description}
      </span>
    </button>
  );
}

/**
 * The chart, its readout and the years: one reveal surface (the readout) for
 * hover, keyboard focus and tap. A new payload starts with nothing selected.
 */
export function AnalogInstrument({ engine, status, assetKey, assetLabel, isDark }) {
  const coarse = useSyncExternalStore(subscribeHoverNone, getHoverNone, getHoverNoneOnServer);
  const boxRef = useRef(null);
  const toolbarRef = useRef(null);
  const leaveTimerRef = useRef(0);
  const [selection, setSelection] = useState({ engine: null, ...EMPTY });
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  const own = selection.engine === engine ? selection : { engine, ...EMPTY };
  const ready = Boolean(engine) && status !== "switching";
  const active = ready ? own.hover ?? own.pinned : null;
  const pinned = ready ? own.pinned : null;
  const engaged = ready && (pointerInside || focusInside || pinned != null);

  const update = (patch) =>
    setSelection((previous) => {
      const base = previous.engine === engine ? previous : { engine, ...EMPTY };
      return { ...base, ...(typeof patch === "function" ? patch(base) : patch) };
    });

  const hoverTo = (item) => {
    clearTimeout(leaveTimerRef.current);
    update({ hover: item });
  };
  const hoverOff = () => {
    clearTimeout(leaveTimerRef.current);
    const forEngine = engine;
    leaveTimerRef.current = setTimeout(() => {
      setSelection((previous) =>
        previous.engine === forEngine ? { ...previous, hover: null } : previous,
      );
    }, INTENT.hoverCloseMs);
  };
  const pick = (item) =>
    update((base) => ({ pinned: sameItem(base.pinned, item) ? null : item }));

  useEffect(() => () => clearTimeout(leaveTimerRef.current), []);

  // While something is pinned: Esc, or a press outside the instrument, clears it.
  useEffect(() => {
    if (!pinned) return undefined;
    const clear = () =>
      setSelection((previous) => ({ ...previous, hover: null, pinned: null }));
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) clear();
    };
    const onPointerDown = (event) => {
      if (!boxRef.current?.contains(event.target)) clear();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [pinned]);

  const k = engine?.outlook?.k ?? engine?.analogs?.length ?? 10;
  const exact = mirrorExact(engine);
  const nextYear = useNextYear(engine);
  const items = chipItems(engine, nextYear);
  const focusIndex = Math.min(own.focusIndex, Math.max(0, items.length - 1));
  const showMirrorSlot = engine ? Boolean(exact) : assetKey === "sp500";

  const onChipKeyDown = (event) => {
    const chips = toolbarRef.current
      ? [...toolbarRef.current.querySelectorAll("button[data-chip]")]
      : [];
    const index = chips.indexOf(event.currentTarget);
    let next = null;
    if (event.key === "ArrowRight") next = (index + 1) % chips.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + chips.length) % chips.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = chips.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      update({ hover: null, pinned: null });
      return;
    }
    if (next == null || chips.length === 0) return;
    event.preventDefault();
    chips[next]?.focus();
  };

  // The chart's keyboard twin: one Tab stop that moves the crosshair month
  // by month over the targets hover gives (Today up to 0, then the median),
  // so keyboard focus reveals what hover reveals. It takes no pointer input.
  const keyTo = (patch) => {
    clearTimeout(leaveTimerRef.current);
    update(patch);
  };
  const onChartKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let next = null;
    if (CHART_STEPS[event.key]) next = own.chartM + CHART_STEPS[event.key];
    else if (event.key === "Home") next = -CHART_MONTHS;
    else if (event.key === "End") next = CHART_MONTHS;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const target = chartTarget(own.chartM);
      keyTo((base) => ({ hover: target, pinned: samePlace(base.pinned, target) ? null : target }));
      return;
    } else if (event.key === "Escape") {
      if (!own.hover && !own.pinned) return;
      event.preventDefault();
      keyTo({ hover: null, pinned: null });
      return;
    }
    if (next == null) return;
    event.preventDefault();
    const value = Math.max(-CHART_MONTHS, Math.min(CHART_MONTHS, next));
    keyTo({ chartM: value, hover: chartTarget(value) });
  };

  const chip = (item, index, mirror = false) => (
    <SetupChip
      key={mirror ? "chip-mirror" : `chip-${item.rank}`}
      item={item}
      index={index}
      mirror={mirror}
      tabbable={index === focusIndex}
      selected={sameItem(active, item)}
      pinned={sameItem(pinned, item)}
      engaged={engaged}
      onEnter={() => hoverTo(item)}
      onLeave={hoverOff}
      onFocusVisible={() => update({ hover: item, focusIndex: index })}
      onFocusOther={() => update({ focusIndex: index })}
      onPress={() => pick(item)}
      onKeyDown={onChipKeyDown}
    />
  );

  return (
    <div
      ref={boxRef}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setPointerInside(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setPointerInside(false);
      }}
    >
      <div className="relative mt-2">
        <AnalogFan
          engine={engine}
          active={active}
          engaged={engaged}
          coarse={coarse}
          isDark={isDark}
          label={chartLabel(engine, assetLabel)}
          onHover={(item) => (item ? hoverTo(item) : hoverOff())}
          onPick={(item) => pick(item)}
        />
        {engine ? (
          <div
            tabIndex={0}
            role="slider"
            aria-label="Outlook chart, month by month"
            aria-valuemin={-12}
            aria-valuemax={12}
            aria-valuenow={own.chartM}
            aria-valuetext={positionText(engine, own.chartM)}
            onKeyDown={onChartKeyDown}
            onFocus={() => {
              setFocusInside(true);
              keyTo((base) => ({ hover: chartTarget(base.chartM) }));
            }}
            onBlur={() => {
              setFocusInside(false);
              setSelection((previous) => ({ ...previous, hover: null }));
            }}
            className="pointer-events-none absolute inset-0 rounded-xl"
          />
        ) : null}
      </div>

      <Readout engine={engine} status={status} active={active} />

      <div className={STRIP_BOX}>
        <p className="text-micro font-medium uppercase tracking-[0.16em] text-(--sh-text-3)">
          Closest setups
        </p>
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label={setupsLabel(k)}
          className={STRIP_ROW}
          onFocus={() => setFocusInside(true)}
          onBlur={(event) => {
            if (toolbarRef.current?.contains(event.relatedTarget)) return;
            setFocusInside(false);
            setSelection((previous) => ({ ...previous, hover: null }));
          }}
        >
          <div className={CHIP_GRID}>
            {items.length === 0
              ? Array.from({ length: 10 }, (_, index) => (
                  <span key={`slot-${index}`} className={CHIP_SLOT} aria-hidden="true" />
                ))
              : items
                  .filter((item) => item.kind === "setup")
                  .map((item, index) => chip(item, index))}
          </div>
          {showMirrorSlot ? (
            <div className={MIRROR_ROW}>
              <span className="mx-1 hidden h-8 w-px bg-(--sh-line-2) sm:block" aria-hidden="true" />
              <span className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
                120 years ago
              </span>
              {items
                .filter((item) => item.kind === "mirror")
                .map((item) => chip(item, items.length - 1, true))}
              {items.length === 0 ? <span className={CHIP_SLOT} aria-hidden="true" /> : null}
            </div>
          ) : null}
        </div>
        <NextYearRow nextYear={nextYear} active={active} pinned={pinned} />
      </div>
    </div>
  );
}
