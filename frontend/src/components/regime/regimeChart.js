// /regime chart and readout helpers, kept apart from regimeUtils.js and
// assetTargets.js so the pages that only need their formatters (/patterns,
// /convergence) do not ship them: dates in the formatDate grammar, a
// level-of-detail selection for dense weekly lines, monotone curves that never
// overshoot a peak or a trough, exact round levels for the log-scaled index
// axis, the Core Index and market flags, and the S&P series' names by period.
// Plain functions: nothing here imports the chart library.
import {
  MONTHS,
  formatDate,
  formatNumber,
  parseIsoDay,
} from "@/components/regime/regimeUtils";

const MINUS = "−";

// A lightweight-charts time ("YYYY-MM-DD", a business day or UTC seconds) as
// an ISO day.
export function chartTimeToIso(time) {
  if (typeof time === "string") return time.slice(0, 10);
  if (typeof time === "number" && Number.isFinite(time)) {
    return new Date(time * 1000).toISOString().slice(0, 10);
  }
  if (time && Number.isFinite(time.year)) {
    const month = String(time.month).padStart(2, "0");
    const day = String(time.day).padStart(2, "0");
    return `${String(time.year).padStart(4, "0")}-${month}-${day}`;
  }
  return null;
}

// Time-axis tick labels. tickMarkType follows lightweight-charts'
// TickMarkType: 0 year ("2008"), 1 month ("Sep"), 2 day of month ("05").
export function formatChartTick(time, tickMarkType) {
  const timestamp = parseIsoDay(chartTimeToIso(time));
  if (timestamp == null) return null;
  const d = new Date(timestamp);
  if (tickMarkType === 0) return String(d.getUTCFullYear());
  if (tickMarkType === 1) return MONTHS[d.getUTCMonth()];
  if (tickMarkType === 2) return String(d.getUTCDate()).padStart(2, "0");
  return formatDate(timestamp);
}

// Bucket width, in chart points, for a level-of-detail line: about one drawn
// point per `targetPx` (2-3 px). Widths step by √2, so zooming changes the
// selection only now and then; 1 means every point is drawn.
export function lodBucketWidth(pxPerPoint, targetPx = 2) {
  if (!(pxPerPoint > 0) || pxPerPoint >= targetPx) return 1;
  return 2 ** (Math.ceil(2 * Math.log2(targetPx / pxPerPoint) - 1e-9) / 2);
}

// lodBucketWidth with hysteresis: the previous width holds while its drawn
// spacing stays within 0.75-1.5 × `targetPx`, so a zoom reselects the drawn
// points only after it has changed the scale by about half (panning never
// does). Pass 0 as `previous` for a fresh width.
export function steadyBucketWidth(previous, pxPerPoint, targetPx = 2) {
  const fresh = lodBucketWidth(pxPerPoint, targetPx);
  if (!(previous >= 1) || !(pxPerPoint > 0)) return fresh;
  const spacing = previous * pxPerPoint;
  if (spacing < 0.75 * targetPx) return fresh;
  return previous === 1 || spacing <= 1.5 * targetPx ? previous : fresh;
}

// A level-of-detail tolerance (in value units) for `wanted`, stepped by √2;
// the previous step holds while it stays within 0.8-1.25 × `wanted`, so the
// autoscale moving during a zoom does not reselect the line on every frame.
export function steadyTolerance(previous, wanted) {
  if (!(wanted > 0)) return previous;
  if (previous >= 0.8 * wanted && previous <= 1.25 * wanted) return previous;
  return 2 ** (Math.round(2 * Math.log2(wanted)) / 2);
}

// Level-of-detail selection for a dense series (indices in drawing order).
// Points fall into buckets `width` chart positions wide, counted from
// position 0, so panning never changes the selection. Each bucket keeps its
// most typical point (the one closest to the bucket mean); a point that is the
// highest or lowest within `reach` buckets either side is always kept, and so
// are the first and the last point and every index in `keep`. Peaks, troughs
// and the latest week stay exact; week-to-week noise is not redrawn at
// sub-pixel scale.
export function selectLevelOfDetail(positions, values, width, reach = 6, keep = null) {
  const total = Math.min(positions.length, values.length);
  if (!(width > 1) || total <= 2) {
    return Int32Array.from({ length: total }, (_, index) => index);
  }
  const kept = keep ? Array.from(keep).filter((index) => index >= 0 && index < total) : [];
  kept.sort((a, b) => a - b);
  const starts = [];
  let bucketId = Number.NaN;
  for (let index = 0; index < total; index += 1) {
    const id = Math.floor(positions[index] / width);
    if (id !== bucketId) {
      starts.push(index);
      bucketId = id;
    }
  }
  const count = starts.length;
  starts.push(total);
  const lowest = new Int32Array(count);
  const highest = new Int32Array(count);
  const typical = new Int32Array(count);
  for (let bucket = 0; bucket < count; bucket += 1) {
    const from = starts[bucket];
    const to = starts[bucket + 1];
    let low = from;
    let high = from;
    let sum = 0;
    for (let index = from; index < to; index += 1) {
      if (values[index] < values[low]) low = index;
      if (values[index] > values[high]) high = index;
      sum += values[index];
    }
    const mean = sum / (to - from);
    let best = from;
    for (let index = from + 1; index < to; index += 1) {
      if (Math.abs(values[index] - mean) < Math.abs(values[best] - mean)) {
        best = index;
      }
    }
    lowest[bucket] = low;
    highest[bucket] = high;
    typical[bucket] = best;
  }
  const selected = [];
  let next = 0;
  for (let bucket = 0; bucket < count; bucket += 1) {
    let isLow = true;
    let isHigh = true;
    const first = Math.max(0, bucket - reach);
    const last = Math.min(count - 1, bucket + reach);
    for (let other = first; other <= last; other += 1) {
      if (values[lowest[other]] < values[lowest[bucket]]) isLow = false;
      if (values[highest[other]] > values[highest[bucket]]) isHigh = false;
    }
    const picks = [];
    if (bucket === 0) picks.push(0);
    if (isLow) picks.push(lowest[bucket]);
    if (isHigh) picks.push(highest[bucket]);
    if (bucket === count - 1) picks.push(total - 1);
    while (next < kept.length && kept[next] < starts[bucket + 1]) {
      picks.push(kept[next]);
      next += 1;
    }
    if (picks.length === 0) picks.push(typical[bucket]);
    picks.sort((a, b) => a - b);
    for (const index of picks) {
      if (selected.length === 0 || index > selected[selected.length - 1]) {
        selected.push(index);
      }
    }
  }
  return Int32Array.from(selected);
}

// The shaded shape for a dense series drawn around zero, as control points
// for traceQuadraticBSpline: one per level-of-detail bucket (`width` chart
// positions wide, counted from position 0, so panning never changes it), at
// the bucket's centre, holding the range of its values taken from zero
// (upper >= 0 >= lower) together with the ranges of `back` buckets before it
// and `ahead` buckets after it; plus a cap at the first and the last point.
// Empty buckets are kept, so the centres stay evenly spaced. Each curve span
// covers one bucket and blends three neighbouring control points, so with
// `back` and `ahead` at 1 or more every point lies inside the shape and every
// extreme reaches its edge. `ahead` is how early the shape can show a reading
// before it happened: keep it at 1.
export function bucketEnvelope(positions, values, width, { back = 1, ahead = 1 } = {}) {
  const total = Math.min(positions.length, values.length);
  if (total === 0 || !(width > 0)) {
    return { at: new Float64Array(0), upper: new Float64Array(0), lower: new Float64Array(0) };
  }
  const firstId = Math.floor(positions[0] / width);
  const count = Math.floor(positions[total - 1] / width) - firstId + 1;
  const highs = new Float64Array(count);
  const lows = new Float64Array(count);
  for (let index = 0; index < total; index += 1) {
    const bucket = Math.floor(positions[index] / width) - firstId;
    highs[bucket] = Math.max(highs[bucket], values[index]);
    lows[bucket] = Math.min(lows[bucket], values[index]);
  }
  const size = count + 2;
  const envelope = {
    at: new Float64Array(size),
    upper: new Float64Array(size),
    lower: new Float64Array(size),
  };
  const first = positions[0];
  const last = positions[total - 1];
  for (let bucket = 0; bucket < count; bucket += 1) {
    let upper = 0;
    let lower = 0;
    const from = Math.max(0, bucket - back);
    const to = Math.min(count - 1, bucket + ahead);
    for (let other = from; other <= to; other += 1) {
      upper = Math.max(upper, highs[other]);
      lower = Math.min(lower, lows[other]);
    }
    envelope.at[bucket + 1] = Math.min(last, Math.max(first, (firstId + bucket + 0.5) * width));
    envelope.upper[bucket + 1] = upper;
    envelope.lower[bucket + 1] = lower;
  }
  envelope.at[0] = first;
  envelope.upper[0] = envelope.upper[1];
  envelope.lower[0] = envelope.lower[1];
  envelope.at[size - 1] = last;
  envelope.upper[size - 1] = envelope.upper[size - 2];
  envelope.lower[size - 1] = envelope.lower[size - 2];
  return envelope;
}

// Adds the uniform quadratic B-spline with control points (xs[i], ys[i]),
// start..end inclusive, to the context's path, backwards when end < start. It
// begins and ends on the end points; in between, each span runs from the
// midpoint of two neighbouring control points to the next midpoint, bent
// towards the control point between them: the curve turns smoothly and never
// leaves the range of the three. `connect` joins it to the current point with
// a line.
export function traceQuadraticBSpline(context, xs, ys, start, end, connect = false) {
  if (connect) context.lineTo(xs[start], ys[start]);
  else context.moveTo(xs[start], ys[start]);
  if (start === end) return;
  const step = end > start ? 1 : -1;
  context.lineTo((xs[start] + xs[start + step]) / 2, (ys[start] + ys[start + step]) / 2);
  for (let i = start + step; i !== end; i += step) {
    context.quadraticCurveTo(
      xs[i],
      ys[i],
      (xs[i] + xs[i + step]) / 2,
      (ys[i] + ys[i + step]) / 2,
    );
  }
  context.lineTo(xs[end], ys[end]);
}

// Adds points to a level-of-detail selection until every original point lies
// within `tolerance` (in value units) of the monotone curve through the
// selection: in each gap between two selected points the worst-fitting point
// is added, for up to `rounds` rounds. Busy stretches keep the detail they
// need; quiet ones stay calm. The curve's shape does not depend on the x or y
// scale, so a tolerance in value units is a tolerance in pixels at one zoom.
export function refineLevelOfDetail(selection, positions, values, tolerance, rounds = 8) {
  let picked = Array.from(selection);
  for (let round = 0; round < rounds; round += 1) {
    const count = picked.length;
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    for (let k = 0; k < count; k += 1) {
      xs[k] = positions[picked[k]];
      ys[k] = values[picked[k]];
    }
    const tangents = monotoneTangents(xs, ys, count);
    const additions = [];
    for (let k = 0; k < count - 1; k += 1) {
      const span = xs[k + 1] - xs[k];
      let worst = tolerance;
      let worstIndex = -1;
      for (let index = picked[k] + 1; index < picked[k + 1]; index += 1) {
        const t = (positions[index] - xs[k]) / span;
        const t2 = t * t;
        const t3 = t2 * t;
        const y =
          (2 * t3 - 3 * t2 + 1) * ys[k] +
          (t3 - 2 * t2 + t) * span * tangents[k] +
          (3 * t2 - 2 * t3) * ys[k + 1] +
          (t3 - t2) * span * tangents[k + 1];
        const gap = Math.abs(y - values[index]);
        if (gap > worst) {
          worst = gap;
          worstIndex = index;
        }
      }
      if (worstIndex >= 0) additions.push(worstIndex);
    }
    if (additions.length === 0) break;
    const merged = [];
    let a = 0;
    let b = 0;
    while (a < picked.length || b < additions.length) {
      if (b >= additions.length || (a < picked.length && picked[a] < additions[b])) {
        merged.push(picked[a]);
        a += 1;
      } else {
        merged.push(additions[b]);
        b += 1;
      }
    }
    picked = merged;
  }
  return Int32Array.from(picked);
}

// Tangents for a monotone cubic through (xs[i], ys[i]), i < count (Steffen,
// 1990). Between two points the curve stays within their values, so a drawn
// peak or trough is exactly the data's, never an overshoot.
export function monotoneTangents(xs, ys, count) {
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

// Adds the monotone curve through points start..end (inclusive) to the
// context's path, backwards when end < start. `connect` joins it to the
// current point with a line instead of starting a new subpath.
export function traceMonotoneCurve(context, xs, ys, tangents, start, end, connect = false) {
  if (connect) context.lineTo(xs[start], ys[start]);
  else context.moveTo(xs[start], ys[start]);
  const step = end >= start ? 1 : -1;
  for (let i = start; i !== end; i += step) {
    const j = i + step;
    const third = (xs[j] - xs[i]) / 3;
    context.bezierCurveTo(
      xs[i] + third,
      ys[i] + tangents[i] * third,
      xs[j] - third,
      ys[j] - tangents[j] * third,
      xs[j],
      ys[j],
    );
  }
}

// The y of that curve at x, or null outside its points.
export function monotoneCurveAt(xs, ys, tangents, count, x) {
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

// An index level (100 = the base week) as change since the base: "+300%",
// "0%", "−50%", "−99.5%". Only as many decimals as the level needs.
export function formatIndexChange(level) {
  const change = Number(level) - 100;
  if (!Number.isFinite(change)) return "—";
  const size = Math.abs(change);
  if (size < 1e-9) return "0%";
  let digits = 0;
  while (digits < 4 && Math.abs(Number(size.toFixed(digits)) - size) > 1e-7) {
    digits += 1;
  }
  return `${change > 0 ? "+" : MINUS}${size.toFixed(digits)}%`;
}

const INDEX_CHANGE_STEPS = [
  [1000, 2],
  [500, 3],
  [100, 4],
  [50, 5],
  [25, 6],
  [10, 7],
  [5, 8],
  [1, 9],
];
const INDEX_MANTISSAS = (() => {
  const list = [
    [1, 1],
    [5, 2],
    [2, 3],
    [2.5, 4],
    [7.5, 4],
  ];
  for (const mantissa of [3, 4, 6, 7, 8, 9]) list.push([mantissa, 5]);
  for (let tenths = 15; tenths < 100; tenths += 10) list.push([tenths / 10, 6]);
  for (let tenths = 11; tenths < 100; tenths += 1) list.push([tenths / 10, 8]);
  return list;
})();

// Candidate levels for a log-scaled index axis, ranked by roundness (lower
// is rounder): the base (0%), each doubling above it, round percentages
// above it, and 1-2-5 steps of the index below it (−50%, −90%, −95%, −99% …).
function indexAxisCandidates(low, high) {
  const ranks = new Map();
  const add = (level, rank) => {
    if (!(level >= low && level <= high)) return;
    const key = Number(level.toPrecision(12));
    if (!(ranks.get(key) <= rank)) ranks.set(key, rank);
  };
  add(100, 0);
  for (let level = 200; level <= high; level *= 2) add(level, 1);
  for (const [step, rank] of INDEX_CHANGE_STEPS) {
    const first = Math.max(step, Math.ceil((low - 100) / step) * step);
    const last = Math.floor((high - 100) / step) * step;
    if (last < first || (last - first) / step > 400) continue;
    for (let change = first; change <= last; change += step) {
      add(100 + change, rank);
    }
  }
  if (low < 100) {
    const lowest = Math.floor(Math.log10(Math.max(low, 1e-6)));
    for (let exponent = lowest; exponent <= 1; exponent += 1) {
      for (const [mantissa, rank] of INDEX_MANTISSAS) {
        const level = Number((mantissa * 10 ** exponent).toPrecision(12));
        if (level < 100) add(level, rank);
      }
    }
  }
  return [...ranks].map(([level, rank]) => ({ level, rank }));
}

// Round levels for the visible part of a log-scaled index axis: the roundest
// first, each new one as far as possible from those already placed and never
// closer than `gap` px to another, inside rows top..bottom; finer ranks are
// used only until `enough` labels are up, so the rhythm stays even. `toY`
// maps a level to its row. Returns [{ level, y, text }] from top to bottom.
export function indexAxisLevels(low, high, toY, { gap, top, bottom, enough = 3 }) {
  if (!(low > 0) || !(high > low)) return [];
  const candidates = indexAxisCandidates(low, high)
    .map((candidate) => ({ ...candidate, y: toY(candidate.level) }))
    .filter(
      (candidate) =>
        Number.isFinite(candidate.y) &&
        candidate.y >= top &&
        candidate.y <= bottom,
    );
  const placed = [];
  const clearance = (y) =>
    placed.reduce((nearest, item) => Math.min(nearest, Math.abs(item.y - y)), Infinity);
  const maxRank = candidates.reduce((max, item) => Math.max(max, item.rank), 0);
  for (let rank = 0; rank <= maxRank; rank += 1) {
    const pool = candidates.filter((candidate) => candidate.rank === rank);
    while (pool.length > 0) {
      let best = 0;
      let bestClearance = -1;
      pool.forEach((candidate, index) => {
        const value = clearance(candidate.y);
        if (value > bestClearance) {
          best = index;
          bestClearance = value;
        }
      });
      if (bestClearance < gap) break;
      placed.push(pool.splice(best, 1)[0]);
    }
    if (placed.length >= enough) break;
  }
  return placed
    .sort((a, b) => a.y - b.y)
    .map(({ level, y }) => ({ level, y, text: formatIndexChange(level) }));
}

// --- Core Index v2 flags and the S&P market flags ---------------------------

const SEVERITY_CLASSES = new Set(["correction", "bear", "crash"]);

// The Core Index's own flag for a week as a short one-line readout
// { label, text }: its warning, or in Maximum Fear (no warning) its severity,
// each with the class of the decline (correction, bear or crash). The class
// describes the fall so far in the current spell and only steps up within it,
// so it can hold through a recovery; in Maximum Fear it is the decline being
// bought. It never describes a fall to come. Null when neither applies or the
// week has no score.
export function coreIndexFlag(point) {
  const severity = SEVERITY_CLASSES.has(point?.core_index_severity)
    ? point.core_index_severity
    : null;
  const text = severity ? `Decline class: ${severity}` : "";
  if (point?.core_index_warning === true) return { label: "Warning", text };
  if (!severity) return null;
  return { label: "Severity", text };
}

// Flags on the S&P 500 shown beside the Core Index (they change nothing in
// it), with the labels the backend contract gives them (`text`; a week's own
// readout names its index, see marketFlagText), and the quiet tones of their
// marks at the foot of the chart. A flag the data does not carry is not shown
// at all.
export const MARKET_FLAGS = [
  {
    field: "core_index_trend_warning",
    label: "Trend warning",
    rule: "below its 40-week average",
    text: "S&P 500 below its 40-week average",
    dark: "rgba(242, 237, 228, 0.5)",
    // At least 3:1 on the paper (2.69:1 at 0.42).
    light: "rgba(20, 18, 26, 0.5)",
  },
  {
    field: "core_index_fast_warning",
    label: "Fast warning",
    rule: "down 7% or more in two weeks",
    text: "S&P 500 down 7% or more in two weeks",
    dark: "rgba(255, 139, 119, 0.62)",
    // At least 3:1 on the paper (2.40:1 at 0.55).
    light: "rgba(192, 68, 47, 0.8)",
  },
];

// --- The S&P series by period ----------------------------------------------
// The NBER/Cowles monthly index to 29 Dec 1927, then daily ^GSPC closes, which
// are the S&P 90 until the S&P 500 began on 4 Mar 1957 (backend contract §4).
// proxy_source does not split at 1957, so that part is read from the date.
const SP500_LAUNCH = "1957-03-04";
const SP90_LAST_DAY = "1957-03-03";
const COWLES_SOURCE = "M1125AUSM343NNBR";
const COWLES_LAST_DAY = "1927-12-29";
const SOURCE_LABELS = {
  [COWLES_SOURCE]: "Cowles monthly index",
  YAHOO_FINANCE_GSPC: "S&P 500",
  SP500: "S&P 500",
  YAHOO_FINANCE_NSEI: "Nifty 50",
};

// The index a value of the S&P series belongs to, for readouts: "Cowles
// index", "S&P 90" or "S&P 500".
export function sp500SeriesLabel(date, source) {
  if (
    source === COWLES_SOURCE ||
    (source == null && typeof date === "string" && date <= COWLES_LAST_DAY)
  ) {
    return "Cowles index";
  }
  if (typeof date === "string" && date < SP500_LAUNCH) return "S&P 90";
  return "S&P 500";
}

// An asset's readout label at one timeline point: the S&P series names its
// index by period; the other assets keep their label.
export function assetLabelAt(asset, point) {
  return asset?.key === "sp500"
    ? sp500SeriesLabel(point?.date, point?.[asset.sourceField])
    : asset?.label;
}

// An asset's value for readouts: an S&P value below 100 (much of the Cowles,
// S&P 90 and early S&P 500 years) with two decimals, as the index is quoted,
// so 4.41 never reads "4"; otherwise the asset's own precision.
export function formatAssetValue(asset, value) {
  const number = Number(value);
  const digits =
    asset?.key === "sp500" && Number.isFinite(number) && Math.abs(number) < 100
      ? 2
      : (asset?.precision ?? 0);
  return formatNumber(value, digits);
}

// A market flag's text at one week, naming the index that week's close
// belongs to: "S&P 90 below its 40-week average" before 4 Mar 1957, "S&P 500
// …" after. The index name never breaks across lines.
export function marketFlagText(flag, point) {
  const index = sp500SeriesLabel(point?.date, point?.proxy_source);
  return `${index.replace(" ", " ")} ${flag.rule}`;
}

// The source list ({ source, start, end }) with readable names, the ^GSPC
// segment split at the S&P 500's launch: "Cowles monthly index",
// "S&P 90 data", "S&P 500". An unknown source keeps its ID.
export function sourcePeriods(sources) {
  const rows = [];
  for (const item of sources ?? []) {
    if (!item?.source) continue;
    const label = SOURCE_LABELS[item.source] ?? item.source;
    if (label !== "S&P 500" || !item.start || item.start >= SP500_LAUNCH) {
      rows.push({ ...item, label });
      continue;
    }
    rows.push({
      ...item,
      label: "S&P 90 data",
      end: item.end && item.end < SP500_LAUNCH ? item.end : SP90_LAST_DAY,
    });
    if (!item.end || item.end >= SP500_LAUNCH) {
      rows.push({ ...item, label: "S&P 500", start: SP500_LAUNCH });
    }
  }
  return rows;
}
