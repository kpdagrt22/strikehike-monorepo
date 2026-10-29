"use client";

/**
 * AlignedPathsChart: two market paths aligned at day 0 (each case's peak, or
 * "today" on Study of Patterns), on one linear "% from each peak" axis, with
 * one shared crosshair, a fixed readout slot above the plot and a Core Index
 * or macro-strength lane under it. Shared by /convergence and Patterns.
 *
 * Props
 *   sides        [SideSpec, SideSpec]   A then B.
 *     key          "a" | "b"
 *     letter       "A" | "B"
 *     short        string        Short name ("GFC") for loading and error text.
 *     status       "loading" | "ready" | "error"
 *     path         object|null   A /cases/{id}/path payload: { t0, resolution, d[], v[], ci[]|null,
 *                                ms[]|null, ends, last_obs }. Days may be negative (from < 0).
 *     error        string?       Shown with a Retry button when status is "error".
 *     onRetry      () => void?
 *     low          { d, v, open }?   The case's own low: the ring (with `markers`) and the rest
 *                                readout. `open` reads "lowest so far".
 *     recovery     { d }?        The case's recovery: a tick on the 0% line (with `markers`).
 *     stop         number?       Last day drawn (the Recovery span rule); null draws to the end.
 *     events       [{ date, name }]?            P1: 4 px ticks on the x baseline; the readout's
 *                                second line names one when the crosshair sits on its day.
 *     recessions   [{ name, start_month, end_month }]?  P1: a 2 px band under the x axis.
 *     drawToken    number?       Change it (with a new case on this side) to draw the line in
 *                                once after its path is ready. Never bump it on a swap, span,
 *                                series, resize or theme change.
 *     laneAt       { peak, low }?  The case's own lane readings for the rest readout ("+12.5 →
 *                                −24.0 at the low"); without it the path's values at day 0 and at
 *                                the low are used.
 *     muteAfter    number?       Patterns: the line after this day is drawn muted ("what followed").
 *   domain       [from, to]    x range in days (from may be negative).
 *   zeroLabel    string        Label of the 0-day tick and hairline: "peak" (default) or "today".
 *   caption      string        The y-axis caption and the chart's heading: "from each peak" (default).
 *   markers      bool          Own market: rings, recovery ticks and the "Low" rest readout;
 *                              otherwise the rest readout is "At each low".
 *   lane         chooseLaneMeasure() result: { key: "ci"|"ms"|null, label, notes, partial, collapsed }.
 *   laneDefinition ReactNode   The lane term's reveal (it ends with "It is not a directional
 *                              prediction." for the Core Index).
 *   controls     ReactNode     Span and series controls, rendered in the chart head.
 *   note         ReactNode?    A quiet line under the controls (e.g. why a series is off).
 *   gapNote      string?       Appended when a path ends at a series gap (`ends: "series_gap"`).
 *   ariaLabel    string        The plot's accessible name.
 *   scrubLabel   string        The hidden range input's label ("Day from peak").
 *   onDayChange  (day|null) => void   The crosshair day (hover or pinned), e.g. for the sky.
 *   rest         { label, a?, b?, lane?: { a?, b? } }?   Replaces the rest readout ("Low" /
 *                              "At each low") where the aligned view has no low to read, e.g.
 *                              Patterns' "Year into day 0": the label, each side's figure and
 *                              each side's lane line (a side's lane note still comes first).
 *   headingLevel 2 | 3         The chart's visually hidden heading (3 inside a section).
 *
 * A side reads nothing past its data: after a path's last sample the line
 * ends, the crosshair shows no value or dot ("data to …"), and the lane too.
 *
 * Interaction (nothing is hover-only): mouse moves set the crosshair and leaving clears it; a
 * touch tap pins it, a horizontal drag scrubs (vertical drags scroll the page: touch-action
 * pan-y) and Clear or a press outside unpins it; the keyboard uses a visually hidden native
 * range input (arrows ±1 day, PageUp/PageDown, Home/End, Escape clears). Within 1.5% of the
 * plot width the crosshair snaps to a low, a recovery or an event. Lines draw in once per case
 * change (600 ms, skipped under prefers-reduced-motion); no other motion.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { coreIndexTone } from "@/components/regime/regimeUtils";
import { getRegimeToneColor, getRegimeToneLabel } from "@/lib/regimeTone";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  MINUS,
  addDays,
  coreIndexBucketOf,
  daysBetween,
  formatCaseDate,
  formatDuration,
  formatMonth,
  formatPct,
  formatSignedValue,
  indexAt,
  macroStateOf,
  valueAt,
} from "@/lib/regime/caseCompare";

const PRICE_H = { wide: 228, narrow: 188 };
const LANE_H = { wide: 76, narrow: 66 };
const PAD = { top: 12, bottom: 8, left: 2, right: { wide: 44, narrow: 34 } };
const SNAP_SHARE = 0.015;
const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 300;

// Line colours as CSS variables, so a theme change never re-renders a path.
const CHART_VARS =
  "[--cv-a:#14121a] [--cv-b:#c0442f] [--cv-ring:#f6f1e9] [--cv-cross:rgb(20_18_26/0.14)] dark:[--cv-a:#f2ede4] dark:[--cv-b:#ff8b77] dark:[--cv-ring:#08080c] dark:[--cv-cross:rgb(255_255_255/0.28)]";

const LETTER_CLASS = {
  a: "text-[#14121a] dark:text-[#f2ede4]",
  b: "text-[#c0442f] dark:text-[#ff8b77]",
};

// A 44 px touch target that does not change the line height of a fixed
// readout: the hit area grows through a pseudo-element on coarse pointers.
const HIT_AREA =
  "relative pointer-coarse:before:absolute pointer-coarse:before:-inset-x-1 pointer-coarse:before:top-1/2 pointer-coarse:before:h-11 pointer-coarse:before:-translate-y-1/2 pointer-coarse:before:content-['']";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function spokenPct(value) {
  if (value == null) return "no data";
  const abs = Math.abs(value).toFixed(1);
  if (Number(abs) === 0) return "0.0 percent";
  return `${value < 0 ? "minus" : "plus"} ${abs} percent`;
}

/**
 * The date of the value shown at `day`: its own sample's date (a weekend, a
 * holiday or a sampled stretch reads the close it carries, not the crosshair's
 * calendar day).
 */
function sideDate(path, day) {
  if (!path?.t0 || !Number.isFinite(day)) return "—";
  const precision = path.resolution === "monthly" ? "month" : "day";
  const index = indexAt(path.d, day);
  return formatCaseDate(addDays(path.t0, index >= 0 ? path.d[index] : day), precision);
}

/**
 * The last day a path has data for: its last sample (a monthly average holds
 * for its month). Nothing is read past it: no value, dot or lane reading is
 * carried into days the series has not reached.
 */
function dataEndOf(path) {
  const d = path?.d;
  if (!Array.isArray(d) || !d.length) return Infinity;
  return d[d.length - 1] + (path.resolution === "monthly" ? 30 : 0);
}

/** The last day drawn and read for a side: the span, its stop and its data. */
function sideEnd(side, path, to) {
  return Math.min(to, side.stop ?? Infinity, dataEndOf(path));
}

/** SVG path for one series: polylines for daily data, steps for monthly. */
function linePath(d, values, { from, end, x, y, step }) {
  if (!Array.isArray(d) || !Array.isArray(values)) return "";
  let out = "";
  let pen = false;
  let lastDay = null;
  for (let i = 0; i < d.length; i += 1) {
    const day = d[i];
    if (day < from) continue;
    if (day > end) {
      if (pen && step) out += `H${x(end).toFixed(1)}`;
      return out;
    }
    const value = values[i];
    if (value == null || !Number.isFinite(value)) {
      pen = false;
      continue;
    }
    const X = x(day).toFixed(1);
    const Y = y(value).toFixed(1);
    if (!pen) out += `M${X},${Y}`;
    else if (step) out += `H${X}V${Y}`;
    else out += `L${X},${Y}`;
    pen = true;
    lastDay = day;
  }
  // A monthly average holds for its month: carry the last step that far.
  if (pen && step && lastDay != null) out += `H${x(Math.min(end, lastDay + 30)).toFixed(1)}`;
  return out;
}

function lastDrawn(d, values, from, end) {
  if (!Array.isArray(d)) return null;
  for (let i = Math.min(d.length - 1, indexAt(d, end)); i >= 0; i -= 1) {
    if (d[i] < from) break;
    if (values[i] != null && Number.isFinite(values[i])) return { day: d[i], value: values[i] };
  }
  return null;
}

// The y grid: the smallest step on a 1 / 2 / 2.5 / 5 × 10^k ladder (at least
// 25 points) that keeps the range to six steps, so a line far above its peak
// (an early Bitcoin case) still gets a handful of readable gridlines.
const STEP_LADDER = [1, 2, 2.5, 5];

function niceStep(range) {
  if (!Number.isFinite(range) || range <= 0) return 25;
  for (let power = 10; power < 1e12; power *= 10) {
    for (const multiple of STEP_LADDER) {
      const step = multiple * power;
      if (step >= 25 && range / step <= 6) return step;
    }
  }
  return range;
}

/** A gridline label: "0%", "+25%", "−50%", "+10,000%". */
function axisPct(value) {
  if (value === 0) return "0%";
  const abs = Math.round(Math.abs(value));
  return `${value < 0 ? MINUS : "+"}${abs >= 1000 ? abs.toLocaleString("en-US") : abs}%`;
}

function xTicks(from, to, narrow, zeroLabel) {
  const span = Math.max(1, to - from);
  let unit;
  let step;
  if (span <= 130) {
    unit = "d";
    step = span <= 60 ? (narrow ? 15 : 10) : 30;
  } else if (span <= 1100) {
    unit = "mo";
    step = (span <= 400 ? 2 : span <= 760 ? 3 : 6) * (narrow ? 2 : 1);
  } else {
    unit = "yr";
    step = (span <= 2900 ? 1 : span <= 7300 ? 2 : 5) * (narrow ? 2 : 1);
  }
  const perUnit = unit === "d" ? 1 : unit === "mo" ? 30.4375 : 365.25;
  const suffix = unit === "d" ? "d" : unit === "mo" ? " mo" : " yr";
  const ticks = [];
  const first = Math.ceil(from / perUnit / step) * step;
  for (let k = first; k * perUnit <= to; k += step) {
    const day = Math.round(k * perUnit);
    if (k !== 0 && (day > to - span * 0.03 || day < from + span * 0.03)) continue;
    ticks.push({
      day,
      label: k === 0 ? zeroLabel : `${k > 0 ? "+" : MINUS}${Math.abs(k)}${suffix}`,
    });
  }
  if (!ticks.some((tick) => tick.day === 0) && from <= 0 && to >= 0) {
    ticks.push({ day: 0, label: zeroLabel });
  }
  return ticks.sort((p, q) => p.day - q.day);
}

function monthStartIso(month) {
  return month ? `${month.slice(0, 7)}-01` : null;
}

function monthEndIso(month) {
  if (!month) return null;
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
}

function laneValueText(laneKey, value) {
  if (value == null) return "—";
  return laneKey === "ms" ? `${Math.round(value)}` : formatSignedValue(value);
}

// The tone word starts with a real space (copied text and screen readers get
// "−9.3 Capital Preservation"); space plus margin keep the 6 px gap.
function LaneTone({ laneKey, value }) {
  if (value == null) return null;
  if (laneKey === "ms") {
    const state = macroStateOf(value);
    const light = getRegimeToneColor(state, false);
    const dark = getRegimeToneColor(state, true);
    return (
      <span
        className="ml-[3px] font-sans font-medium text-(--tone-l) dark:text-(--tone-d)"
        style={{ "--tone-l": light, "--tone-d": dark }}
      >
        {" "}
        {(getRegimeToneLabel(state) ?? "").toLowerCase()}
      </span>
    );
  }
  const bucket = coreIndexBucketOf(value);
  const light = coreIndexTone(bucket, false);
  const dark = coreIndexTone(bucket, true);
  return (
    <span
      className="ml-[3px] font-sans font-medium text-(--tone-l) dark:text-(--tone-d)"
      style={{ "--tone-l": light.color, "--tone-d": dark.color }}
    >
      {" "}
      {light.label}
    </span>
  );
}

/** The A / B letter before a readout, followed by a real space (the gap was a margin). */
function SideLetter({ side }) {
  return (
    <>
      <span className={`font-semibold ${LETTER_CLASS[side.key] ?? ""}`}>{side.letter}</span>{" "}
    </>
  );
}

/** The lane's term: hover (120 ms in, 300 ms out), focus + Enter, or a tap reveal it. */
function LaneTerm({ label, children }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const id = useId();
  const tipId = `cv-lane-tip-${id.replace(/[^a-zA-Z0-9-]/g, "")}`;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const later = (next, ms) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), ms);
  };

  return (
    <span
      className="relative"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") later(true, HOVER_OPEN_MS);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") later(false, HOVER_CLOSE_MS);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={tipId}
        onClick={() => {
          window.clearTimeout(timer.current);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
        onBlur={() => later(false, 0)}
        className={`${HIT_AREA} text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3) underline decoration-(--sh-line-2) decoration-dotted underline-offset-4 transition-colors duration-(--sh-dur-micro) hover:text-(--sh-text-2) focus-visible:text-(--sh-text-2)`}
      >
        {label}
      </button>
      <span
        id={tipId}
        role="note"
        hidden={!open}
        style={{
          background:
            "linear-gradient(var(--sh-surface-overlay), var(--sh-surface-overlay)), var(--engine-fallback)",
        }}
        className="absolute left-0 top-[calc(100%+8px)] z-30 w-[min(300px,calc(100vw-48px))] rounded-xl border border-(--sh-line-1) bg-(--sh-surface-overlay) px-3 py-2.5 text-micro font-normal normal-case leading-normal tracking-normal text-(--sh-text-2) shadow-(--sh-shadow-overlay)"
      >
        {children}
      </span>
    </span>
  );
}

export function AlignedPathsChart({
  sides,
  domain,
  zeroLabel = "peak",
  caption = "from each peak",
  markers = true,
  lane,
  laneDefinition = null,
  controls = null,
  note = null,
  gapNote = null,
  ariaLabel,
  scrubLabel = "Day from peak",
  onDayChange,
  rest = null,
  headingLevel = 2,
}) {
  const reduceMotion = usePrefersReducedMotion();
  const plotRef = useRef(null);
  const rootRef = useRef(null);
  const headingRef = useRef(null);
  const lineRefs = useRef({});
  const animated = useRef(
    Object.fromEntries(sides.map((side) => [side.key, side.drawToken ?? 0])),
  );
  const frame = useRef(0);
  const pendingX = useRef(null);
  const touch = useRef(null);

  const [width, setWidth] = useState(0);
  const [hoverDay, setHoverDay] = useState(null);
  const [pinnedDay, setPinnedDay] = useState(null);
  // "focus": the scrub input pinned day 0 on focus alone, so leaving it
  // unpins; any key or drag makes the pin the reader's own.
  const pinSource = useRef(null);

  const [from, to] = domain;
  const narrow = width > 0 && width < 560;
  const H = narrow ? PRICE_H.narrow : PRICE_H.wide;
  const LH = narrow ? LANE_H.narrow : LANE_H.wide;
  const padRight = narrow ? PAD.right.narrow : PAD.right.wide;
  const plotW = Math.max(1, width - PAD.left - padRight);

  // The first width is read before paint, so a chart mounted under content
  // that is already on screen never draws one frame at the wrong height.
  useLayoutEffect(() => {
    const node = plotRef.current;
    if (!node) return;
    const next = Math.round(node.getBoundingClientRect().width);
    setWidth((previous) => (previous === next ? previous : next));
  }, []);

  useEffect(() => {
    const node = plotRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect?.width ?? 0);
      setWidth((previous) => (previous === next ? previous : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => window.cancelAnimationFrame(frame.current), []);

  const laneKey = lane?.key ?? null;

  const geometry = useMemo(() => {
    if (!width) return null;
    const x = (day) => PAD.left + ((day - from) / Math.max(1, to - from)) * plotW;
    const range = { lo: 0, hi: 0 };
    const drawn = [];
    for (const side of sides) {
      const path = side.status === "ready" ? side.path : null;
      const end = sideEnd(side, path, to);
      if (!path?.d) {
        drawn.push({ side, path: null, end });
        continue;
      }
      for (let i = 0; i < path.d.length; i += 1) {
        const day = path.d[i];
        if (day < from) continue;
        if (day > end) break;
        const value = path.v[i];
        if (value == null) continue;
        range.lo = Math.min(range.lo, value);
        range.hi = Math.max(range.hi, value);
      }
      drawn.push({ side, path, end });
    }
    const yMin = Math.max(-100, Math.floor((range.lo - 4) / 5) * 5);
    const yMax = Math.ceil((range.hi + 3) / 5) * 5;
    const y = (value) => PAD.top + (1 - (value - yMin) / Math.max(1, yMax - yMin)) * (H - PAD.top - PAD.bottom);
    const step = niceStep(yMax - yMin);
    const grid = [];
    for (let g = Math.ceil(yMin / step) * step; g <= yMax; g += step) grid.push(g);
    const laneMin = laneKey === "ms" ? 0 : -50;
    const laneMax = laneKey === "ms" ? 100 : 50;
    const ly = (value) => 6 + (1 - (value - laneMin) / (laneMax - laneMin)) * (LH - 12);
    const laneGuides = laneKey === "ms" ? [60, 40] : [25, 0, -25];

    const lines = drawn.map(({ side, path, end }) => {
      if (!path) return { key: side.key, price: "", lane: "", laneMuted: "", last: null, muted: "" };
      const step = path.resolution === "monthly";
      const mute = Number.isFinite(side.muteAfter) ? side.muteAfter : null;
      const solidEnd = mute != null ? Math.min(end, mute) : end;
      const price = linePath(path.d, path.v, { from, end: solidEnd, x, y, step });
      const muted = mute != null && mute < end
        ? linePath(path.d, path.v, { from: mute, end, x, y, step })
        : "";
      // The lane follows the price line: muted after `muteAfter` too.
      const laneValues = laneKey ? path[laneKey] : null;
      const lanePath = laneValues
        ? linePath(path.d, laneValues, { from, end: solidEnd, x, y: ly, step })
        : "";
      const laneMuted = laneValues && mute != null && mute < end
        ? linePath(path.d, laneValues, { from: mute, end, x, y: ly, step })
        : "";
      const last = lastDrawn(path.d, path.v, from, end);
      return { key: side.key, price, lane: lanePath, laneMuted, muted, last, end };
    });

    // A / B end letters, nudged apart when they collide, then off a gridline
    // label when one lands level with it in or near the gutter (so "B" never
    // reads as part of "+25%").
    const ends = lines
      .filter((line) => line.last)
      .map((line) => ({
        key: line.key,
        x: Math.min(x(line.last.day) + 6, width - padRight + 4),
        y: y(line.last.value),
      }));
    if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 14) {
      const [upper, lower] = ends[0].y <= ends[1].y ? [ends[0], ends[1]] : [ends[1], ends[0]];
      const mid = (upper.y + lower.y) / 2;
      upper.y = mid - 7;
      lower.y = mid + 7;
    }
    // A letter in or near the gutter (close enough to read as one with a
    // label) keeps 10 px off every gridline label; letters stay 14 px apart.
    // Each takes the nearest such place to where it is.
    const nearLabels = width - padRight - 24;
    const labelYs = grid.map((value) => y(value));
    const placed = [];
    for (const end of [...ends].sort((p, q) => p.y - q.y)) {
      const fits = (yy) =>
        yy >= PAD.top - 4 &&
        yy <= H - PAD.bottom + 4 &&
        placed.every((other) => Math.abs(yy - other) >= 14) &&
        (end.x < nearLabels || labelYs.every((ly) => Math.abs(yy - ly) >= 10));
      const candidates = [
        end.y,
        ...labelYs.flatMap((ly) => [ly - 10, ly + 10]),
        ...placed.flatMap((other) => [other - 14, other + 14]),
      ];
      const best = candidates
        .filter(fits)
        .sort((p, q) => Math.abs(p - end.y) - Math.abs(q - end.y))[0];
      if (best != null) end.y = best;
      placed.push(end.y);
    }

    const snaps = [];
    const marks = [];
    const ticks = [];
    const bands = [];
    sides.forEach((side, sideIndex) => {
      const path = side.status === "ready" ? side.path : null;
      const end = sideEnd(side, path, to);
      // Rings and ticks belong to a drawn line: none for a side that is
      // still loading or failed.
      if (path && markers && side.low && side.low.d >= from && side.low.d <= end) {
        marks.push({ kind: "low", key: side.key, cx: x(side.low.d), cy: y(side.low.v) });
        snaps.push(side.low.d);
      }
      if (path && markers && side.recovery && side.recovery.d >= from && side.recovery.d <= end) {
        marks.push({ kind: "recovery", key: side.key, cx: x(side.recovery.d), cy: y(0) });
        snaps.push(side.recovery.d);
      }
      const t0 = path?.t0;
      if (!t0) return;
      for (const event of side.events ?? []) {
        const day = daysBetween(t0, event.date);
        if (day == null || day < from || day > end) continue;
        ticks.push({ key: side.key, day, x: x(day), name: event.name, date: event.date });
        snaps.push(day);
      }
      for (const recession of side.recessions ?? []) {
        const start = daysBetween(t0, monthStartIso(recession.start_month));
        const stop = daysBetween(t0, monthEndIso(recession.end_month));
        if (start == null || stop == null || stop < from || start > to) continue;
        bands.push({
          key: side.key,
          row: sideIndex,
          start,
          stop,
          x1: x(clamp(start, from, to)),
          x2: x(clamp(stop, from, to)),
          recession,
        });
      }
    });

    return {
      x, y, ly, yMin, yMax, grid, laneGuides, lines, ends, marks, ticks, bands,
      snaps: [...new Set(snaps)],
      xTicks: xTicks(from, to, narrow, zeroLabel),
    };
  }, [width, from, to, plotW, H, LH, padRight, narrow, sides, laneKey, markers, zeroLabel]);

  const day = hoverDay ?? pinnedDay;

  useEffect(() => {
    onDayChange?.(day);
  }, [day, onDayChange]);

  // Draw the changed side's line in once (pathLength 1, dashoffset 1 -> 0).
  useLayoutEffect(() => {
    for (const side of sides) {
      const token = side.drawToken ?? 0;
      const element = lineRefs.current[side.key];
      if (animated.current[side.key] === token) continue;
      if (side.status !== "ready" || !element || !element.getAttribute("d")) continue;
      animated.current[side.key] = token;
      if (reduceMotion) continue;
      element.style.transition = "none";
      element.style.strokeDasharray = "1";
      element.style.strokeDashoffset = "1";
      element.getBoundingClientRect();
      element.style.transition =
        "stroke-dashoffset var(--sh-dur-data) var(--sh-ease-out)";
      element.style.strokeDashoffset = "0";
      const done = () => {
        element.style.transition = "";
        element.style.strokeDasharray = "";
        element.style.strokeDashoffset = "";
        element.removeEventListener("transitionend", done);
      };
      element.addEventListener("transitionend", done);
    }
  });

  // A press outside the chart unpins the crosshair.
  useEffect(() => {
    if (pinnedDay == null) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setPinnedDay(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [pinnedDay]);

  const dayAt = (clientX) => {
    const node = plotRef.current;
    if (!node || !geometry) return null;
    const rect = node.getBoundingClientRect();
    const px = clamp(clientX - rect.left, PAD.left, PAD.left + plotW);
    let target = Math.round(from + ((px - PAD.left) / plotW) * (to - from));
    let best = SNAP_SHARE * plotW;
    for (const snap of geometry.snaps) {
      const distance = Math.abs(geometry.x(snap) - px);
      if (distance <= best) {
        best = distance;
        target = snap;
      }
    }
    return clamp(target, from, to);
  };

  const onPointerMove = (event) => {
    if (event.pointerType === "mouse") {
      pendingX.current = event.clientX;
      if (frame.current) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0;
        const next = dayAt(pendingX.current);
        setHoverDay(next);
      });
      return;
    }
    const start = touch.current;
    if (!start || start.id !== event.pointerId) return;
    if (!start.scrubbing && Math.abs(event.clientX - start.x) > 6) start.scrubbing = true;
    if (start.scrubbing) {
      pinSource.current = null;
      setPinnedDay(dayAt(event.clientX));
    }
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse") return;
    touch.current = { id: event.pointerId, x: event.clientX, scrubbing: false };
  };

  const onPointerUp = (event) => {
    const start = touch.current;
    touch.current = null;
    if (!start || start.id !== event.pointerId || start.scrubbing) return;
    pinSource.current = null;
    setPinnedDay(dayAt(event.clientX));
  };

  const onPointerLeave = (event) => {
    if (event.pointerType !== "mouse") return;
    window.cancelAnimationFrame(frame.current);
    frame.current = 0;
    setHoverDay(null);
  };

  const scrubValue = clamp(pinnedDay ?? 0, from, to);

  const valuesAt = (target) =>
    sides.map((side) => {
      const path = side.status === "ready" ? side.path : null;
      if (!path || target == null || target > sideEnd(side, path, to)) return null;
      return valueAt(path.d, path.v, target);
    });

  const active = day != null && geometry ? day : null;
  const activeValues = valuesAt(active);
  const scrubText =
    active == null
      ? `${zeroLabel === "today" ? "Today" : "At the peak"}`
      : `Day ${active}. ${sides
          .map((side, index) => `${side.letter} ${spokenPct(activeValues[index])}`)
          .join(". ")}.`;

  // Context for the readout's second line: an event on this day, else the
  // NBER recession the day falls in.
  const context = [];
  if (active != null && geometry) {
    for (const tick of geometry.ticks) {
      if (tick.day === active) context.push(`${tick.key.toUpperCase()} ${formatCaseDate(tick.date)} · ${tick.name}`);
    }
    if (!context.length) {
      for (const band of geometry.bands) {
        if (active >= band.start && active <= band.stop) {
          context.push(
            `${band.key.toUpperCase()} in the ${band.recession.name} (NBER ${formatMonth(band.recession.start_month)} – ${formatMonth(band.recession.end_month)})`,
          );
        }
      }
    }
  }

  const restPart = (side) => {
    if (rest && rest[side.key] != null) return rest[side.key];
    if (markers) {
      if (!side.low) return "—";
      return `${formatPct(side.low.v)} after ${formatDuration(side.low.d)}${side.low.open ? ", lowest so far" : ""}`;
    }
    const path = side.status === "ready" ? side.path : null;
    if (!path || !side.low) return "—";
    return formatPct(valueAt(path.d, path.v, side.low.d));
  };

  const sideReadout = (side, index) => {
    if (side.status === "loading") return <span className="text-(--sh-text-3)">Loading {side.short}…</span>;
    if (side.status === "error") {
      return (
        <span className="inline-flex flex-wrap items-center gap-x-2 text-[#c0442f] dark:text-[#ff8b77]">
          Could not load this path.
          <button
            type="button"
            onClick={() => {
              headingRef.current?.focus({ preventScroll: true });
              side.onRetry?.();
            }}
            className={`${HIT_AREA} rounded-full border border-(--sh-line-2) px-2.5 py-px font-sans text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover)`}
          >
            Retry {side.letter}
          </button>
        </span>
      );
    }
    if (active == null) return <b className="font-medium text-[#14121a] dark:text-[#f2ede4]">{restPart(side)}</b>;
    const value = activeValues[index];
    const path = side.path;
    const lastDay = path?.d?.[path.d.length - 1];
    if (value == null) {
      if (Number.isFinite(lastDay) && active > dataEndOf(path)) {
        if (path.ends === "series_gap") {
          return (
            <span>
              series ends {formatMonth(path.last_obs ?? addDays(path.t0, lastDay))}
              {gapNote ? ` (${gapNote})` : ""}
            </span>
          );
        }
        // Past the series' latest close: say where the data stops, never a
        // value or a date beyond it.
        if (path.ends === "data_end" && path.last_obs) {
          return (
            <span>
              data to {formatCaseDate(path.last_obs, path.resolution === "monthly" ? "month" : "day")}
            </span>
          );
        }
      }
      return <span>—</span>;
    }
    return (
      <>
        <b className="font-medium text-[#14121a] dark:text-[#f2ede4]">{formatPct(value)}</b>
        <span> · {sideDate(path, active)}</span>
      </>
    );
  };

  // The case's own readings (`laneAt`) come with the catalogue, so the rest
  // readout is final before the path arrives and does not change under it.
  const laneRest = (side) => {
    const path = side.status === "ready" ? side.path : null;
    const note = lane?.notes?.[side.key];
    if (note) return <span>{note}</span>;
    if (rest?.lane?.[side.key] != null) return <span>{rest.lane[side.key]}</span>;
    const values = path && laneKey ? path[laneKey] : null;
    const atPeak =
      side.laneAt?.peak ?? (values ? valueAt(path.d, values, Math.max(0, from)) : null);
    const atLow =
      side.laneAt?.low ?? (values && side.low ? valueAt(path.d, values, side.low.d) : null);
    if (atPeak == null && atLow == null) return <span>—</span>;
    return (
      <span>
        {laneValueText(laneKey, atPeak)} → <b className="font-medium text-[#14121a] dark:text-[#f2ede4]">{laneValueText(laneKey, atLow)}</b> at the low
      </span>
    );
  };

  const laneActive = (side) => {
    const path = side.status === "ready" ? side.path : null;
    const note = lane?.notes?.[side.key];
    const values = path && laneKey ? path[laneKey] : null;
    const value = values && active <= sideEnd(side, path, to) ? valueAt(path.d, values, active) : null;
    if (value == null) return <span>{note ?? "—"}</span>;
    return (
      <span>
        <b className="font-medium text-[#14121a] dark:text-[#f2ede4]">{laneValueText(laneKey, value)}</b>
        <LaneTone laneKey={laneKey} value={value} />
      </span>
    );
  };

  const g = geometry;
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <div ref={rootRef} className={CHART_VARS} data-cv-chart="">
      <Heading ref={headingRef} tabIndex={-1} className="sr-only">
        Paths {caption}
      </Heading>
      <div className="flex flex-col-reverse gap-2.5 xl:flex-row xl:items-start xl:justify-between xl:gap-4">
        {/* Fixed height: hover changes the text, never the layout. */}
        <div
          data-cv-readout=""
          className="grid h-[4.4rem] min-w-0 shrink-0 content-start gap-y-0.5 text-micro text-(--sh-text-3) sm:h-11 xl:flex-1"
        >
          <div className="flex min-w-0 items-center gap-x-[18px] gap-y-0.5 max-sm:grid max-sm:grid-cols-1">
            <span className="flex shrink-0 items-center justify-between gap-2 font-medium uppercase tracking-[0.14em]">
              {active != null ? `Day ${active}` : rest?.label ?? (markers ? "Low" : "At each low")}
              {pinnedDay != null ? (
                <button
                  type="button"
                  onClick={() => setPinnedDay(null)}
                  aria-label="Clear crosshair"
                  className={`${HIT_AREA} rounded-full border border-(--sh-line-1) px-2.5 py-px font-sans text-micro font-medium normal-case tracking-normal text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) sm:hidden`}
                >
                  Clear
                </button>
              ) : null}
            </span>
            {sides.map((side, index) => (
              <span key={side.key} className="min-w-0 truncate font-mono tabular-nums text-(--sh-text-2)">
                <SideLetter side={side} />
                {sideReadout(side, index)}
              </span>
            ))}
            {pinnedDay != null ? (
              <button
                type="button"
                onClick={() => setPinnedDay(null)}
                aria-label="Clear crosshair"
                className={`${HIT_AREA} z-10 hidden shrink-0 rounded-full border border-(--sh-line-1) px-2.5 py-px text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) sm:inline-flex`}
              >
                Clear
              </button>
            ) : null}
          </div>
          <p className="truncate text-(--sh-text-3)">{context.join(" · ")}</p>
        </div>
        {controls ? (
          <div className="flex min-w-0 flex-col items-stretch gap-1.5 xl:items-end">
            {controls}
            {note}
          </div>
        ) : null}
      </div>

      <div
        ref={plotRef}
        data-cv-plot=""
        className="relative mt-1.5 cursor-crosshair touch-pan-y select-none rounded-[10px] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-4 has-[input:focus-visible]:outline-(--sh-focus)"
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          touch.current = null;
        }}
        onPointerLeave={onPointerLeave}
      >
        <div className="relative" style={{ height: H }}>
          {g ? (
            <svg
              width={width}
              height={H}
              viewBox={`0 0 ${width} ${H}`}
              role="img"
              aria-label={ariaLabel}
              className="block overflow-visible"
            >
              {g.grid.map((value) => (
                <line
                  key={value}
                  x1={PAD.left}
                  x2={width - padRight}
                  y1={g.y(value)}
                  y2={g.y(value)}
                  stroke={value === 0 ? "var(--sh-line-2)" : "var(--sh-line-1)"}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {from < 0 ? (
                <line
                  x1={g.x(0)}
                  x2={g.x(0)}
                  y1={0}
                  y2={H}
                  stroke="var(--sh-line-2)"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {g.lines.map((line) =>
                line.muted ? (
                  <path
                    key={`${line.key}-muted`}
                    d={line.muted}
                    fill="none"
                    stroke={`var(--cv-${line.key})`}
                    strokeOpacity={0.4}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null,
              )}
              {g.lines.map((line) => (
                <path
                  key={line.key}
                  ref={(node) => {
                    lineRefs.current[line.key] = node;
                  }}
                  data-side={line.key}
                  d={line.price}
                  pathLength={1}
                  fill="none"
                  stroke={`var(--cv-${line.key})`}
                  strokeWidth={1.75}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {g.marks.map((mark) =>
                mark.kind === "low" ? (
                  <circle
                    key={`${mark.key}-low`}
                    cx={mark.cx}
                    cy={mark.cy}
                    r={3.5}
                    fill="none"
                    stroke={`var(--cv-${mark.key})`}
                    strokeWidth={1.5}
                  />
                ) : (
                  <line
                    key={`${mark.key}-rec`}
                    x1={mark.cx}
                    x2={mark.cx}
                    y1={mark.cy - 5}
                    y2={mark.cy + 5}
                    stroke={`var(--cv-${mark.key})`}
                    strokeWidth={1.5}
                  />
                ),
              )}
              {g.ticks.map((tick, index) => (
                <line
                  key={`${tick.key}-ev-${index}`}
                  x1={tick.x}
                  x2={tick.x}
                  y1={H - 4}
                  y2={H}
                  stroke={`var(--cv-${tick.key})`}
                  strokeOpacity={0.4}
                  strokeWidth={1.5}
                />
              ))}
              {sides.map((side) => {
                const line = g.lines.find((item) => item.key === side.key);
                const path = side.status === "ready" ? side.path : null;
                if (path?.ends !== "series_gap" || !line?.last) return null;
                const cx = g.x(line.last.day);
                const cy = g.y(line.last.value);
                return (
                  <line
                    key={`${side.key}-cap`}
                    x1={cx}
                    x2={cx}
                    y1={cy - 3}
                    y2={cy + 3}
                    stroke={`var(--cv-${side.key})`}
                    strokeWidth={1.75}
                    strokeLinecap="round"
                  />
                );
              })}
              {active != null ? (
                <g aria-hidden="true">
                  <line
                    x1={g.x(active)}
                    x2={g.x(active)}
                    y1={PAD.top - 6}
                    y2={H}
                    stroke="var(--cv-cross)"
                    vectorEffect="non-scaling-stroke"
                  />
                  {sides.map((side, index) =>
                    activeValues[index] == null ? null : (
                      <circle
                        key={side.key}
                        cx={g.x(active)}
                        cy={g.y(activeValues[index])}
                        r={4}
                        fill={`var(--cv-${side.key})`}
                        stroke="var(--cv-ring)"
                        strokeWidth={2}
                      />
                    ),
                  )}
                </g>
              ) : null}
            </svg>
          ) : null}
          {g ? (
            <div aria-hidden="true">
              {/* Keyed by position: when a path arrives and rescales the axis,
                  labels are replaced rather than moved (no layout shift). */}
              {g.grid.map((value) => (
                <span
                  key={`${value}:${Math.round(g.y(value))}`}
                  className="pointer-events-none absolute right-0 whitespace-nowrap font-mono text-micro leading-none text-(--sh-text-3)"
                  style={{ top: g.y(value) - 6 }}
                >
                  {axisPct(value)}
                </span>
              ))}
              {g.ends.map((end) => (
                <span
                  key={`${end.key}:${Math.round(end.x)}:${Math.round(end.y)}`}
                  className={`pointer-events-none absolute whitespace-nowrap font-mono text-micro font-semibold leading-none ${LETTER_CLASS[end.key] ?? ""}`}
                  style={{ left: end.x, top: end.y - 6 }}
                >
                  {end.key.toUpperCase()}
                </span>
              ))}
              <span
                className="pointer-events-none absolute whitespace-nowrap font-mono text-micro leading-none text-(--sh-text-3)"
                style={{ left: PAD.left, top: 0 }}
              >
                {caption}
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-2.5 border-t border-(--sh-line-1) pt-2.5">
          <div className="flex min-h-[2.25rem] flex-wrap items-baseline gap-x-[18px] gap-y-1 text-micro text-(--sh-text-3) sm:min-h-[1.75rem]">
            {laneKey ? (
              <LaneTerm label={lane.label}>{laneDefinition}</LaneTerm>
            ) : null}
            {laneKey ? (
              sides.map((side) => (
                <span key={side.key} className="font-mono tabular-nums text-(--sh-text-2)">
                  <SideLetter side={side} />
                  {active == null ? laneRest(side) : laneActive(side)}
                </span>
              ))
            ) : (
              <span>{lane?.collapsed}</span>
            )}
            {laneKey && lane?.partial ? <span>{lane.partial}</span> : null}
          </div>
          {laneKey ? (
            <div className="relative mt-1.5" style={{ height: LH }}>
              {g ? (
                <svg
                  width={width}
                  height={LH}
                  viewBox={`0 0 ${width} ${LH}`}
                  aria-hidden="true"
                  className="block overflow-visible"
                >
                  {g.laneGuides.map((value) => (
                    <line
                      key={value}
                      x1={PAD.left}
                      x2={width - padRight}
                      y1={g.ly(value)}
                      y2={g.ly(value)}
                      stroke={value === 0 ? "var(--sh-line-2)" : "var(--sh-line-1)"}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {from < 0 ? (
                    <line x1={g.x(0)} x2={g.x(0)} y1={0} y2={LH} stroke="var(--sh-line-2)" vectorEffect="non-scaling-stroke" />
                  ) : null}
                  {g.lines.map((line) =>
                    line.laneMuted ? (
                      <path
                        key={`${line.key}-muted`}
                        d={line.laneMuted}
                        fill="none"
                        stroke={`var(--cv-${line.key})`}
                        strokeOpacity={0.4}
                        strokeWidth={1.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null,
                  )}
                  {g.lines.map((line) => (
                    <path
                      key={line.key}
                      d={line.lane}
                      fill="none"
                      stroke={`var(--cv-${line.key})`}
                      strokeWidth={1.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {active != null ? (
                    <g>
                      <line x1={g.x(active)} x2={g.x(active)} y1={0} y2={LH} stroke="var(--cv-cross)" vectorEffect="non-scaling-stroke" />
                      {sides.map((side) => {
                        const path = side.status === "ready" ? side.path : null;
                        const values = path?.[laneKey];
                        const value = values && active <= sideEnd(side, path, to) ? valueAt(path.d, values, active) : null;
                        if (value == null) return null;
                        return (
                          <circle
                            key={side.key}
                            cx={g.x(active)}
                            cy={g.ly(value)}
                            r={3.5}
                            fill={`var(--cv-${side.key})`}
                            stroke="var(--cv-ring)"
                            strokeWidth={2}
                          />
                        );
                      })}
                    </g>
                  ) : null}
                </svg>
              ) : null}
              {g ? (
                <div aria-hidden="true">
                  {g.laneGuides.map((value) => (
                    <span
                      key={value}
                      className="pointer-events-none absolute right-0 whitespace-nowrap font-mono text-micro leading-none text-(--sh-text-3)"
                      style={{ top: g.ly(value) - 6 }}
                    >
                      {laneKey === "ms" ? value : value === 0 ? "0" : formatSignedValue(value, 0)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="relative mt-1 h-[18px]" aria-hidden="true">
          {g
            ? g.xTicks.map((tick, index) => {
                const left = g.x(tick.day);
                const shift = index === 0 && tick.day === from ? "0" : left > width - padRight - 24 ? "-100%" : "-50%";
                return (
                  <span
                    key={`${tick.day}:${Math.round(left)}`}
                    className="pointer-events-none absolute top-0.5 whitespace-nowrap font-mono text-micro leading-none text-(--sh-text-3)"
                    style={{ left, transform: `translateX(${shift})` }}
                  >
                    {tick.label}
                  </span>
                );
              })
            : null}
        </div>
        {/* NBER recessions, one thin row per side, labelled in the axis
            gutter. Always present (empty without recessions), so the card
            keeps its height; the readout names the recession under the
            crosshair. */}
        <div className="relative mt-1 h-3" aria-hidden="true">
          {g
            ? g.bands.map((band, index) => (
                <span
                  key={`${band.key}-${index}:${Math.round(band.x1)}:${Math.round(band.x2)}`}
                  className={`absolute h-0.5 rounded-full opacity-30 ${band.key === "a" ? "bg-(--cv-a)" : "bg-(--cv-b)"}`}
                  style={{ left: band.x1, width: Math.max(2, band.x2 - band.x1), top: 3 + band.row * 3 }}
                />
              ))
            : null}
          {g?.bands.length ? (
            <span className="pointer-events-none absolute right-0 top-px whitespace-nowrap font-mono text-micro leading-none text-(--sh-text-3)">
              NBER
            </span>
          ) : null}
        </div>

        <input
          type="range"
          data-cv-scrub=""
          className="sr-only"
          min={from}
          max={to}
          step={1}
          value={scrubValue}
          aria-label={scrubLabel}
          aria-valuetext={scrubText}
          onFocus={() => {
            if (pinnedDay != null) return;
            pinSource.current = "focus";
            setPinnedDay(scrubValue);
          }}
          onBlur={() => {
            // Tabbing through without moving leaves no pin behind.
            if (pinSource.current !== "focus") return;
            pinSource.current = null;
            setPinnedDay(null);
          }}
          onChange={(event) => {
            pinSource.current = null;
            setPinnedDay(Number(event.target.value));
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && pinnedDay != null) {
              event.preventDefault();
              event.stopPropagation();
              pinSource.current = null;
              setPinnedDay(null);
            }
          }}
        />
      </div>
    </div>
  );
}
