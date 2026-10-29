"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { AlignedPathsChart } from "@/components/regime/AlignedPathsChart";
import { AstroLens } from "@/components/regime/AstroLens";
import { CasePicker, CaseTriggerPlaceholder } from "@/components/regime/CasePicker";
import { ASSET_TARGETS } from "@/components/regime/assetTargets";
import { coreIndexTone } from "@/components/regime/regimeUtils";
import { OnboardingModal } from "@/components/ui/OnboardingModal";
import { getRegimeToneColor, getRegimeToneLabel } from "@/lib/regimeTone";
import {
  SERIES_OPTIONS,
  addDays,
  chooseLaneMeasure,
  daysBetween,
  describePair,
  footingLine,
  formatCaseDate,
  formatDuration,
  formatMonth,
  formatPct,
  formatSignedValue,
  isOpen,
  isUnobservable,
  lineStop,
  pathKey,
  pathUrl,
  recessionContext,
  recessionSpan,
  recessionsFor,
  requestSeries,
  seriesAvailability,
  spanEnd,
} from "@/lib/regime/caseCompare";

// --------------------------------------------------------------- caches
// JSON kept for the session and read through useSyncExternalStore. Paths are
// keyed like the proxy (regime-case-path:{id}:{series}:{from}:{align}), so
// swapping sides and switching back to a series are instant; sky ranges are
// keyed by URL. One request per key at a time; an abort frees its key.

const EMPTY_MAP = new Map();

function createJsonStore(isValid, failure) {
  let entries = new Map();
  const inflight = new Map();
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());
  const put = (key, entry) => {
    entries = new Map(entries);
    entries.set(key, entry);
    emit();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => entries,
    has: (key) => entries.has(key),
    pending: (key) => inflight.has(key),
    drop(key) {
      if (!entries.has(key)) return;
      entries = new Map(entries);
      entries.delete(key);
      emit();
    },
    load(key, url, signal) {
      if (entries.get(key)?.status === "ready") return;
      if (inflight.has(key)) return;
      const request = fetch(url, signal ? { signal } : undefined)
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(
              payload?.detail || payload?.error || `${failure} (${response.status}).`,
            );
          }
          if (!isValid(payload)) throw new Error(failure);
          put(key, { status: "ready", data: payload });
        })
        .catch((error) => {
          if (error?.name === "AbortError") return;
          put(key, { status: "error", error: error?.message || failure });
        })
        .finally(() => {
          if (inflight.get(key) === request) inflight.delete(key);
        });
      inflight.set(key, request);
      signal?.addEventListener("abort", () => {
        if (inflight.get(key) === request) inflight.delete(key);
      });
    },
  };
}

const pathStore = createJsonStore(
  (payload) => Array.isArray(payload?.d) && Array.isArray(payload?.v),
  "Could not load this path.",
);
const skyStore = createJsonStore(
  (payload) => Boolean(payload?.bodies?.Sun?.lon),
  "Could not load the sky range.",
);

const getEmptyMap = () => EMPTY_MAP;
const getNoDay = () => null;

/** The crosshair day for the sky, outside React state so the page does not re-render on hover. */
function createDayStore() {
  let day = null;
  const listeners = new Set();
  return {
    get: () => day,
    set: (next) => {
      const value = next ?? null;
      if (value === day) return;
      day = value;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// --------------------------------------------------------------- selection

const SPANS = [
  { key: "decline", label: "Decline" },
  { key: "recovery", label: "Recovery" },
];
const SERIES_KEYS = new Set(SERIES_OPTIONS.map((option) => option.key));
const UNKNOWN_NOTE = "That case is not in the archive; showing the default pair.";

function readSelection(payload, search) {
  const cases = payload.cases;
  const ids = new Set(cases.map((c) => c.id));
  const fallback = payload.default_pair ?? { a: cases[0].id, b: cases[1].id };
  const params = new URLSearchParams(search);
  const askedA = params.get("a");
  const askedB = params.get("b");
  let a = fallback.a;
  let b = fallback.b;
  let unknown = false;
  if (askedA || askedB) {
    const okA = !askedA || ids.has(askedA);
    const okB = !askedB || ids.has(askedB);
    if (!okA || !okB) {
      unknown = true;
    } else {
      a = askedA ?? fallback.a;
      b = askedB ?? fallback.b;
      // The same case on both sides: keep A, and B takes the default pair's
      // other case (both ids exist, so no "not in the archive" note).
      if (a === b) b = a === fallback.b ? fallback.a : fallback.b;
    }
  }
  const byId = new Map(cases.map((c) => [c.id, c]));
  let series = params.get("series") ?? "own";
  if (
    !SERIES_KEYS.has(series) ||
    !seriesAvailability(byId.get(a), byId.get(b), series, payload.coverage).ok
  ) {
    series = "own";
  }
  const span = params.get("span") === "recovery" ? "recovery" : "decline";
  return { selection: { a, b, series, span, source: "load" }, unknown };
}

// --------------------------------------------------------------- styles

const GRID =
  "grid grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] sm:grid-cols-[148px_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-6 lg:grid-cols-[196px_minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-8";
const COL_LABEL = "col-span-3 sm:col-span-1";
const COL_A = "col-start-1 sm:col-start-2";
const COL_B = "col-start-3";
const SEAM = "col-start-2 w-px justify-self-center bg-(--sh-line-1) sm:hidden";
const CARD = "rounded-[1.6rem] border border-(--sh-line-1) bg-(--sh-surface-card)";
const CAPS = "text-micro font-medium uppercase tracking-[0.16em] text-(--sh-text-3)";
const QUIET_LINK =
  "text-micro text-black/60 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center dark:text-white/60 dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]";
const SEGMENT =
  "inline-flex shrink-0 items-center gap-0.5 rounded-full border border-(--sh-line-1) bg-black/[0.025] p-0.5 dark:bg-white/[0.035]";
// On coarse pointers the hit area grows to 45 px through ::before (the
// buttons are 23 px tall), so the control keeps its size.
const SEGMENT_BUTTON =
  "relative rounded-full px-2.5 py-1 text-micro font-medium transition-colors duration-(--sh-dur-micro) pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-[11px] pointer-coarse:before:content-['']";
const SEGMENT_IDLE =
  "text-black/60 hover:text-black/75 focus-visible:text-black/75 dark:text-white/60 dark:hover:text-white/75 dark:focus-visible:text-white/75";
// The compare bar's frost: a square layer behind the rounded bar that reaches
// 24 px past it vertically and the gutter's width sideways (the blur samples
// real content there instead of mirroring at its own edge, where text would
// read through). At rest its mask is the bar's rectangle, hard-edged, so
// nothing outside the bar is touched; while the bar is stuck the margin fades
// out, so text frosts progressively as it reaches the bar. Only the mask
// changes, never the geometry.
const FROST =
  "pointer-events-none absolute -inset-x-(--cv-frost-x) -inset-y-6 backdrop-blur-[16px] [--cv-frost-x:0.75rem] sm:[--cv-frost-x:1rem] [mask-composite:intersect] " +
  "[mask-image:linear-gradient(to_right,transparent_var(--cv-frost-x),#000_var(--cv-frost-x),#000_calc(100%_-_var(--cv-frost-x)),transparent_calc(100%_-_var(--cv-frost-x))),linear-gradient(to_bottom,transparent_1.5rem,#000_1.5rem,#000_calc(100%_-_1.5rem),transparent_calc(100%_-_1.5rem))] " +
  "[[data-cv-stuck]_&]:[mask-image:linear-gradient(to_right,transparent,#000_var(--cv-frost-x),#000_calc(100%_-_var(--cv-frost-x)),transparent),linear-gradient(to_bottom,transparent,#000_1.5rem,#000_calc(100%_-_1.5rem),transparent)]";
const SIDE_INK = {
  a: "text-[#14121a] dark:text-[#f2ede4]",
  b: "text-[#c0442f] dark:text-[#ff8b77]",
};
const SIDE_SWATCH = {
  a: "bg-[#14121a] dark:bg-[#f2ede4]",
  b: "bg-[#c0442f] dark:bg-[#ff8b77]",
};

const CORE_INDEX_DEFINITION = (
  <>
    Core Index is a weekly trend-and-stress reading of the S&amp;P 500 from
    −50 to +50, read as a contrarian sentiment map. A high score means
    euphoria and elevated risk, a low score means fear and accumulation. It is
    not a directional prediction.
    <span className="mt-1.5 block font-mono text-(--sh-text-3)">
      +25 Risk Elevated · 0 · −25 Maximum Fear
    </span>
  </>
);
const MACRO_DEFINITION = (
  <>
    Macro strength is the 0–100 macro meter used on the Regime page: 60 and
    above reads favorable, 40 and below disruptive, neutral between.
  </>
);

// --------------------------------------------------------------- controls

function SwapIcon({ className = "h-3 w-3" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 7h11l-3-3M17 17H6l3 3" />
    </svg>
  );
}

function SegmentedRadio({ label, value, options, onChange }) {
  const refs = useRef([]);
  const index = Math.max(0, options.findIndex((option) => option.key === value));
  const handleKey = (event) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].key);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={SEGMENT}>
      {options.map((option, position) => {
        const checked = option.key === value;
        return (
          <button
            key={option.key}
            ref={(node) => {
              refs.current[position] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.key)}
            onKeyDown={handleKey}
            className={`${SEGMENT_BUTTON} ${
              checked
                ? "bg-white/80 text-[#14121a] dark:bg-white/10 dark:text-[#f2ede4]"
                : SEGMENT_IDLE
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SeriesControl({ value, options, onChange, onBlocked }) {
  const current = options.find((option) => option.key === value) ?? options[0];
  return (
    <>
      <div role="group" aria-label="Series" className={`${SEGMENT} flex-wrap max-sm:hidden`}>
        {options.map((option) => {
          const pressed = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={pressed}
              aria-disabled={option.ok ? undefined : "true"}
              title={option.ok ? undefined : option.reason}
              onClick={() => (option.ok ? onChange(option.key) : onBlocked(option.reason))}
              className={`${SEGMENT_BUTTON} ${
                pressed
                  ? option.color
                    ? "bg-white/80 text-(--asset-light) dark:bg-(--asset-dark)/12 dark:text-(--asset-dark)"
                    : "bg-white/80 text-[#14121a] dark:bg-white/10 dark:text-[#f2ede4]"
                  : option.ok
                    ? SEGMENT_IDLE
                    : "cursor-not-allowed text-(--sh-text-4)"
              }`}
              style={
                pressed && option.color
                  ? { "--asset-light": option.color.light, "--asset-dark": option.color.dark }
                  : undefined
              }
            >
              {option.label}
              {option.ok ? null : (
                <span className="sr-only">, unavailable: {option.reason}</span>
              )}
            </button>
          );
        })}
      </div>
      <label className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-(--sh-line-1) bg-black/[0.025] pl-3 pr-1.5 text-micro text-(--sh-text-2) sm:hidden dark:bg-white/[0.035]">
        <span className="shrink-0 font-medium uppercase tracking-[0.12em] text-(--sh-text-3)">
          Series
        </span>
        <select
          value={current.key}
          onChange={(event) => onChange(event.target.value)}
          className="w-full min-w-0 rounded-md bg-transparent py-1 text-micro text-[#14121a] dark:text-[#f2ede4]"
        >
          {options.map((option) => (
            <option key={option.key} value={option.key} disabled={!option.ok}>
              {option.ok
                ? option.label
                : `${option.label} — ${option.reason.charAt(0).toLowerCase()}${option.reason.slice(1)}`}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function Sentence({ tokens }) {
  return tokens.map((token, index) => {
    if (token.kind === "subject") {
      return (
        <span key={index} className={`font-semibold ${SIDE_INK[token.side] ?? ""}`}>
          {token.text}
        </span>
      );
    }
    if (token.kind === "num") {
      return (
        <span
          key={index}
          className="whitespace-nowrap font-mono text-[0.94em] tabular-nums text-[#14121a] dark:text-[#f2ede4]"
        >
          {token.text}
        </span>
      );
    }
    return <Fragment key={index}>{token.text}</Fragment>;
  });
}

// --------------------------------------------------------------- ledger

// A real space leads the label, so copied text and screen readers get
// "+12.5 Balanced Growth"; space plus margin keep the 6 px gap.
function Tone({ light, dark, children }) {
  return (
    <span
      className="ml-[3px] font-sans text-micro font-medium text-(--tone-l) dark:text-(--tone-d)"
      style={{ "--tone-l": light, "--tone-d": dark }}
    >
      {" "}
      {children}
    </span>
  );
}

function precisionOf(c) {
  return c?.series?.precision === "month" ? "month" : "day";
}

function spliceNote(c, path) {
  const splices = path?.splices ?? [];
  if (!splices.length || !path?.t0) return null;
  const limit = Number.isFinite(c.days_to_recovery)
    ? c.days_to_recovery
    : path.d?.[path.d.length - 1] ?? 0;
  const splice = splices.find((item) => item.d <= limit);
  if (!splice) return null;
  const target = String(path.series_label ?? "").split("→").pop().trim();
  return target ? ` → ${target} from ${formatMonth(addDays(path.t0, splice.d))}` : null;
}

// The ledger heads' "Compare with today": a 44 px touch target drawn by a
// pseudo-element, so it adds one text line, not 44 px, to each head on phones.
const HEAD_LINK =
  "relative text-micro text-black/60 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] pointer-coarse:before:absolute pointer-coarse:before:-inset-x-1 pointer-coarse:before:top-1/2 pointer-coarse:before:h-11 pointer-coarse:before:-translate-y-1/2 pointer-coarse:before:content-[''] dark:text-white/60 dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]";

function ColumnHead({ side, c, kindLabel, recessions, ownPath }) {
  const recession = recessions[0];
  const events = (c.events ?? []).slice(0, 2);
  const context = [
    recession ? recessionContext(recession) : null,
    ...events.map((event) => `${event.name} ${formatCaseDate(event.date)}`),
  ].filter(Boolean);
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <span className="flex flex-wrap items-center gap-x-2 font-mono text-micro text-(--sh-text-3)">
        <span className={`h-0.5 w-3.5 rounded-full ${SIDE_SWATCH[side]}`} aria-hidden="true" />
        {side.toUpperCase()}
        <span className="max-sm:hidden">· {kindLabel}</span>
        {/* The region only where the market label does not already say it. */}
        <span className={String(kindLabel).includes(c.region) ? "sm:hidden" : undefined}>
          · {c.region}
        </span>
      </span>
      <h3 className="text-[1.125rem] font-semibold leading-[1.15] tracking-[-0.03em] text-[#14121a] sm:text-[1.375rem] dark:text-[#f2ede4]">
        {c.name}
      </h3>
      <span className="text-micro leading-[1.4] text-(--sh-text-3)">
        {c.series?.label}
        {spliceNote(c, ownPath)}
      </span>
      {context.length ? (
        <span className="mt-1 text-meta leading-normal text-(--sh-text-2) max-sm:hidden">
          {context.join(" · ")}
        </span>
      ) : null}
      {/* Study of Patterns compares today with a past case on its own lens
          markets (the S&P 500 and the Nifty 50); an open case is today. */}
      {(c.series?.key === "sp500" || c.series?.key === "nifty") && !isOpen(c) ? (
        <Link
          href={`/patterns?case=${encodeURIComponent(c.id)}`}
          aria-label={`Compare with today: ${c.name}, on Study of Patterns`}
          className={`${HEAD_LINK} self-start`}
        >
          Compare with today
        </Link>
      ) : null}
    </div>
  );
}

function measureCell(c, laneKey, which, coverage) {
  if (laneKey === "ms") {
    const reading = c.macro_strength?.[which];
    if (reading?.value == null) {
      return {
        main: "—",
        sub: `Macro strength begins ${formatMonth(coverage?.macro_strength_start)}`,
        muted: true,
      };
    }
    const state = reading.regime_state;
    return {
      main: `${Math.round(reading.value)}`,
      tone: state
        ? {
            light: getRegimeToneColor(state, false),
            dark: getRegimeToneColor(state, true),
            text: (getRegimeToneLabel(state) ?? "").toLowerCase(),
          }
        : null,
    };
  }
  const value = c.core_index?.[which];
  if (value == null) {
    return {
      main: "—",
      sub: `Core Index begins ${formatMonth(coverage?.core_index_start)}`,
      muted: true,
    };
  }
  const bucket = c.core_index?.[`${which}_bucket`];
  const light = coreIndexTone(bucket, false);
  const dark = coreIndexTone(bucket, true);
  return {
    main: formatSignedValue(value),
    tone: { light: light.color, dark: dark.color, text: light.label },
  };
}

function ledgerRows(caseA, caseB, { laneKey, recessionsById, coverage }) {
  const measure = laneKey === "ms" ? "Macro strength" : "Core Index";
  const gap = coverage?.equity_gap;
  const back = (c) => {
    const precision = precisionOf(c);
    if (Number.isFinite(c.days_to_recovery) && c.recovery) {
      const lower = c.lower_low
        ? `after a lower low of ${formatPct(c.lower_low.pct_from_peak)} in ${formatCaseDate(c.lower_low.date, "month")}`
        : null;
      return {
        main: formatCaseDate(c.recovery, precision),
        sub: `${formatDuration(c.days_to_recovery)} after the peak`,
        sub2: lower,
      };
    }
    if (isUnobservable(c)) {
      return {
        main: "Not observable",
        sub: gap ? `no equity data ${formatMonth(gap.start)} – ${formatMonth(gap.end)}` : null,
        muted: true,
      };
    }
    const latest = c.latest;
    return {
      main: `Not by ${formatCaseDate(latest?.date, precision)}`,
      sub: latest
        ? `${formatPct(latest.pct_from_peak)} from the peak on ${formatCaseDate(latest.date, precision)}`
        : null,
      muted: true,
    };
  };
  const recession = (c) => {
    const list = recessionsFor(c, recessionsById);
    if (!list.length) return { main: "None during this decline", muted: true, sans: true };
    return { lines: list.map((r) => `${r.name} · ${recessionSpan(r)}`), sans: true };
  };
  const cell = (c, kind) => {
    const precision = precisionOf(c);
    const open = isOpen(c);
    switch (kind) {
      case "peak":
        return { main: formatCaseDate(c.peak, precision) };
      case "low":
        return {
          main: formatPct(c.depth_pct),
          sub: `${formatCaseDate(c.trough, precision)}${open ? " · lowest so far" : ""}`,
        };
      case "fall":
        return { main: `${formatDuration(c.days_to_trough)}${open ? " so far" : ""}` };
      case "back":
        return back(c);
      case "atPeak":
        return measureCell(c, laneKey, "at_peak", coverage);
      case "atLow":
        return measureCell(c, laneKey, "at_trough", coverage);
      default:
        return recession(c);
    }
  };
  return [
    ["peak", "Peak"],
    ["low", "Low"],
    ["fall", "Peak → low"],
    ["back", "Back at peak"],
    ["atPeak", `${measure} at peak`],
    ["atLow", `${measure} at low`],
    ["nber", "NBER recession"],
  ].map(([kind, label]) => ({ kind, label, a: cell(caseA, kind), b: cell(caseB, kind) }));
}

function LedgerCell({ value, side }) {
  return (
    <td
      role="cell"
      className={`min-w-0 ${side === "a" ? COL_A : `${COL_B} relative max-sm:before:absolute max-sm:before:inset-y-0 max-sm:before:-left-[22px] max-sm:before:w-px max-sm:before:bg-(--sh-line-1) max-sm:before:content-['']`} ${
        value.sans ? "font-sans text-meta" : "font-mono text-body tabular-nums"
      } ${value.muted ? "text-(--sh-text-3)" : "text-[#14121a] dark:text-[#f2ede4]"}`}
    >
      {value.lines ? (
        value.lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))
      ) : (
        <span>{value.main}</span>
      )}
      {value.tone ? (
        <Tone light={value.tone.light} dark={value.tone.dark}>
          {value.tone.text}
        </Tone>
      ) : null}
      {value.sub ? (
        <small className="mt-0.5 block font-sans text-micro text-(--sh-text-3)">{value.sub}</small>
      ) : null}
      {value.sub2 ? (
        <small className="mt-0.5 block font-sans text-micro text-(--sh-text-3)">{value.sub2}</small>
      ) : null}
    </td>
  );
}

function Ledger({ caseA, caseB, kindLabels, recessionsById, coverage, laneKey, ownPaths }) {
  const rows = ledgerRows(caseA, caseB, { laneKey, recessionsById, coverage });
  return (
    <section aria-labelledby="cv-ledger-title" className={`${CARD} mt-4 px-3.5 pb-3 pt-2 sm:px-6 sm:pb-4 sm:pt-3`}>
      <h2 id="cv-ledger-title" className="sr-only">
        The two cases
      </h2>
      <div className={`${GRID} border-b border-(--sh-line-1) pb-3 pt-1`}>
        <div className="hidden sm:block" aria-hidden="true" />
        <div className={COL_A}>
          <ColumnHead
            side="a"
            c={caseA}
            kindLabel={kindLabels[caseA.kind] ?? caseA.kind}
            recessions={recessionsFor(caseA, recessionsById)}
            ownPath={ownPaths.a}
          />
        </div>
        <div className={SEAM} aria-hidden="true" />
        <div className={COL_B}>
          <ColumnHead
            side="b"
            c={caseB}
            kindLabel={kindLabels[caseB.kind] ?? caseB.kind}
            recessions={recessionsFor(caseB, recessionsById)}
            ownPath={ownPaths.b}
          />
        </div>
      </div>
      <table role="table" className="block w-full">
        <thead role="rowgroup" className="sr-only">
          <tr role="row">
            <th role="columnheader" scope="col">
              Reading
            </th>
            <th role="columnheader" scope="col">
              A: {caseA.name}
            </th>
            <th role="columnheader" scope="col">
              B: {caseB.name}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="block">
          {rows.map((row) => (
            <tr
              key={row.kind}
              role="row"
              className={`${GRID} items-baseline border-t border-(--sh-line-1) py-2 first:border-t-0 sm:py-2.5`}
            >
              <th
                role="rowheader"
                scope="row"
                className={`${COL_LABEL} pb-1 text-left text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3) sm:pb-0`}
              >
                {row.label}
              </th>
              <LedgerCell value={row.a} side="a" />
              <LedgerCell value={row.b} side="b" />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// --------------------------------------------------------------- sky

function skyLabel(c) {
  const sky = c.sky ?? {};
  const month = sky.precision === "month";
  return `${formatCaseDate(sky.date ?? c.peak, "day")}${month ? " · month start" : ""}`;
}

const SKY_BODIES = ["Sun", "Moon", "Saturn"];

// One sample per day up to 800 days, then weekly, then monthly: at most about
// 800 samples (≈ 22 KB) per side. The step follows the span (both sides share
// it); the range ends where the side's data does (`lastDay`), never later.
function skyRangeUrl(c, domainEnd, lastDay = Infinity) {
  const start = c.sky?.date;
  if (!start || c.sky?.available === false || !Number.isFinite(domainEnd)) return null;
  const step = domainEnd <= 800 ? 1 : domainEnd <= 5600 ? 7 : 30;
  const end = addDays(start, Math.max(0, Math.min(domainEnd, lastDay)));
  return `/api/chrono/positions?start=${start}&end=${end}&step=${step}&bodies=${SKY_BODIES.join(",")}`;
}

/**
 * The last day (from the side's sky date) its line has data for on the
 * series shown: the series' latest observation. The sky follows the crosshair
 * only up to here, so it never shows a date the chart has no data for.
 */
function skyDataDays(c, series, coverage) {
  const key = series === "own" ? c.series?.key : series;
  const last = coverage?.series_last_obs?.[key];
  const days = last ? daysBetween(c.sky?.date ?? c.peak, last) : null;
  return Number.isFinite(days) ? days : Infinity;
}

function bodiesAt(entry, index) {
  if (entry?.status !== "ready") return null;
  const out = {};
  for (const name of SKY_BODIES) {
    const series = entry.data.bodies?.[name];
    if (!series || index < 0 || index >= series.lon.length) return null;
    out[name] = { lon: series.lon[index], retro: Boolean(series.retro?.[index]) };
  }
  return out;
}

/**
 * The sky at each peak; while the crosshair is active both columns follow its
 * day through the range data (fetched on first use). Until both ranges are in,
 * both stay at the peak: the two columns never show different days. Past
 * either side's data (an open case, a recent one) both stay at the peak too.
 */
function SkySection({ caseA, caseB, domainEnd, dayStore, coverage, series = "own" }) {
  const crosshairDay = useSyncExternalStore(dayStore.subscribe, dayStore.get, getNoDay);
  const ranges = useSyncExternalStore(skyStore.subscribe, skyStore.snapshot, getEmptyMap);
  const lastA = skyDataDays(caseA, series, coverage);
  const lastB = skyDataDays(caseB, series, coverage);
  const urlA = skyRangeUrl(caseA, domainEnd, lastA);
  const urlB = skyRangeUrl(caseB, domainEnd, lastB);
  const day = crosshairDay != null && crosshairDay <= Math.min(lastA, lastB) ? crosshairDay : null;
  const wanted = day != null;

  useEffect(() => {
    if (!wanted) return;
    for (const url of [urlA, urlB]) {
      if (url && !skyStore.has(url) && !skyStore.pending(url)) skyStore.load(url, url);
    }
  }, [wanted, urlA, urlB]);

  let sampled = null;
  let bodiesA = null;
  let bodiesB = null;
  if (wanted && urlA && urlB) {
    const step = Number(new URLSearchParams(urlA.split("?")[1]).get("step")) || 1;
    const index = Math.round(day / step);
    bodiesA = bodiesAt(ranges.get(urlA), index);
    bodiesB = bodiesAt(ranges.get(urlB), index);
    // Day 0 is the peak: keep the peak's own title, label and reading.
    if (bodiesA && bodiesB && index > 0) sampled = index * step;
    else bodiesA = bodiesB = null;
  }
  const label = (c) =>
    sampled == null ? skyLabel(c) : formatCaseDate(addDays(c.sky?.date ?? c.peak, sampled));
  // Known from the catalogue: no request for a date the ephemeris does not cover.
  const ephemeris = coverage?.ephemeris;
  const outside = (c) =>
    c.sky?.available === false && ephemeris?.start && ephemeris?.end
      ? `Ephemeris coverage is ${ephemeris.start} to ${ephemeris.end}.`
      : null;

  return (
    <section aria-labelledby="cv-sky-title" className={`${CARD} mt-4 px-3.5 pb-3.5 pt-2.5 sm:px-6 sm:pb-[18px] sm:pt-3.5`}>
      <div className={`${GRID} gap-y-1.5`}>
        <h2 id="cv-sky-title" className={`${COL_LABEL} ${CAPS} pb-1 sm:pt-0.5`}>
          {sampled == null ? "Sky at peak" : `Sky on day ${sampled}`}
        </h2>
        <div className={COL_A}>
          <AstroLens
            key={caseA.sky?.date ?? caseA.peak}
            date={caseA.sky?.date ?? caseA.peak}
            precision={caseA.sky?.precision ?? "day"}
            label={label(caseA)}
            bodies={bodiesA}
            unavailable={outside(caseA)}
          />
        </div>
        <div className={SEAM} aria-hidden="true" />
        <div className={COL_B}>
          <AstroLens
            key={caseB.sky?.date ?? caseB.peak}
            date={caseB.sky?.date ?? caseB.peak}
            precision={caseB.sky?.precision ?? "day"}
            label={label(caseB)}
            bodies={bodiesB}
            unavailable={outside(caseB)}
          />
        </div>
      </div>
      <p className="mt-3 text-micro leading-relaxed text-(--sh-text-3)">
        Lahiri sidereal ephemeris. A historical correspondence lens, not a
        causal input to the Core Index composite.
      </p>
    </section>
  );
}

// --------------------------------------------------------------- method

const THRESHOLD_NAMES = {
  us_equity: "US stocks",
  india_equity: "Nifty 50",
  treasury: "the Treasury model",
  gold: "gold, monthly average",
  bitcoin: "Bitcoin",
};

function thresholdClause(kinds) {
  const groups = new Map();
  for (const kind of kinds ?? []) {
    const list = groups.get(kind.threshold_pct) ?? [];
    list.push(THRESHOLD_NAMES[kind.key] ?? kind.label);
    groups.set(kind.threshold_pct, list);
  }
  const parts = [...groups.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([threshold, names]) => `${threshold}% (${names.join(", ")})`);
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

function MethodDetails({ data }) {
  const coverage = data.coverage ?? {};
  const segments = coverage.us_equity_segments ?? [];
  const cowlesEnd = segments[0]?.end;
  const ephemeris = coverage.ephemeris ?? {};
  return (
    <details className={`group mt-4 rounded-[1.4rem] border border-(--sh-line-1) bg-(--sh-surface-card) p-5 sm:p-6`}>
      <summary className="-m-2 flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-2 text-micro font-medium uppercase tracking-[0.16em] text-black/60 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden dark:text-white/60">
        Method & limits
        <span className="text-base font-normal text-black/60 transition-transform group-open:rotate-45 dark:text-white/60">
          +
        </span>
      </summary>
      <div className="mt-4 grid gap-4 text-meta leading-relaxed text-black/70 sm:grid-cols-2 lg:grid-cols-3 dark:text-white/70">
        <p>
          Each case is found in the data with one rule per market. A decline
          begins at the highest close before a fall of at least{" "}
          {thresholdClause(data.kinds)}. The low is the lowest close before the
          series regains that peak or rebounds strongly. The recovery is the
          first close back at or above the peak. Days are calendar days from
          each peak. A case carries its common historical name where one
          exists; otherwise it is named after the index it was measured on and
          its years.
        </p>
        <p>
          US stocks are the Cowles index (monthly average) to{" "}
          {formatMonth(cowlesEnd)}, then daily S&amp;P closes: the S&amp;P 90
          until {formatMonth(coverage.sp500_index_start)}
          {" and the S&P 500 from then. "}Gold is the World Bank London monthly
          average; bonds are a 7.5-duration 10-year Treasury total-return
          model; Nifty 50 is Yahoo Finance ^NSEI from{" "}
          {formatMonth(coverage.series_first_obs?.nifty)}; Bitcoin is the
          Blockchain.com daily price from{" "}
          {formatMonth(coverage.series_first_obs?.bitcoin)}. NBER recessions are
          shown as context: they are dated by month, after the fact.
        </p>
        <p>
          The macro lane shows the Core Index when both cases have one (from{" "}
          {formatMonth(coverage.core_index_start)}; few of its stress inputs
          exist before 1953), otherwise macro strength (from{" "}
          {formatMonth(coverage.macro_strength_start)}; partial inputs before{" "}
          {formatMonth(coverage.macro_strength_full_from)}). Sky positions are
          Lahiri sidereal ephemeris values ({ephemeris.start?.slice(0, 4)}–
          {ephemeris.end?.slice(0, 4)}) at each peak; month-precise cases use the
          first of the month and omit the Moon.
        </p>
      </div>
      <p className="mt-4 border-t border-black/5 pt-3 text-micro text-black/60 dark:border-white/5 dark:text-white/60">
        Data version {data.as_of} · descriptive historical research. Not
        investment advice.
      </p>
    </details>
  );
}

// --------------------------------------------------------------- page

const SPAN_DRAW_RESET = { a: 0, b: 0 };

export default function ConvergencePage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [catalogue, setCatalogue] = useState({ status: "loading", data: null, error: null });
  const [sel, setSel] = useState(null);
  const [note, setNote] = useState(null);
  // { key, content }: what the read showed when a change made it wait for
  // paths; it stays on screen while the read for `key` loads.
  const [held, setHeld] = useState(null);
  const [drawTokens, setDrawTokens] = useState(SPAN_DRAW_RESET);
  const [attempts, setAttempts] = useState({ a: 0, b: 0 });
  const [announcement, setAnnouncement] = useState({ text: "", n: 0 });
  const [seriesNote, setSeriesNote] = useState(null);
  const [dayStore] = useState(createDayStore);
  const previewTimer = useRef(0);
  const mainRef = useRef(null);
  const barRef = useRef(null);
  const barShown = catalogue.status !== "error";

  // While the compare bar is stuck under the header, <main> carries
  // data-cv-stuck and a sky cover hides everything above the bar's top edge,
  // so nothing scrolls into the band between the header and the bar. At rest
  // and on the way up, the header's own scrim fades the page as on every
  // engine page. --cv-gutter keeps the cover off the scrollbar.
  useEffect(() => {
    const main = mainRef.current;
    const bar = barRef.current;
    if (!main || !bar) return undefined;
    let frame = 0;
    let stuck = false;
    let gutter = -1;
    const measure = () => {
      frame = 0;
      const nextGutter = main.offsetWidth - main.clientWidth;
      if (nextGutter !== gutter) {
        gutter = nextGutter;
        main.style.setProperty("--cv-gutter", `${gutter}px`);
      }
      const clear = parseFloat(window.getComputedStyle(main).paddingTop) || 0;
      const next =
        main.scrollTop > 0 &&
        bar.getBoundingClientRect().top - main.getBoundingClientRect().top <= clear + 0.5;
      if (next === stuck) return;
      stuck = next;
      main.toggleAttribute("data-cv-stuck", next);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    main.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      main.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.cancelAnimationFrame(frame);
      main.removeAttribute("data-cv-stuck");
    };
  }, [barShown]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/regime/cases", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.detail || payload?.error || `Case archive returned ${response.status}.`,
          );
        }
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload?.cases) || payload.cases.length < 2) {
          throw new Error("The case archive is empty.");
        }
        const initial = readSelection(payload, window.location.search);
        setCatalogue({ status: "ready", data: payload, error: null });
        setSel(initial.selection);
        setNote(initial.unknown ? UNKNOWN_NOTE : null);
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setCatalogue({ status: "error", data: null, error: error?.message ?? "" });
      });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => () => window.clearTimeout(previewTimer.current), []);

  const data = catalogue.data;
  const coverage = data?.coverage ?? null;
  const byId = useMemo(() => new Map((data?.cases ?? []).map((c) => [c.id, c])), [data]);
  const recessionsById = useMemo(
    () => new Map((data?.recessions ?? []).map((r) => [r.id, r])),
    [data],
  );
  const kindLabels = useMemo(
    () => Object.fromEntries((data?.kinds ?? []).map((kind) => [kind.key, kind.label])),
    [data],
  );

  const caseA = sel ? byId.get(sel.a) ?? null : null;
  const caseB = sel ? byId.get(sel.b) ?? null : null;
  const series = sel?.series ?? "own";
  const span = sel?.span ?? "decline";

  const seriesA = requestSeries(caseA, series);
  const seriesB = requestSeries(caseB, series);
  const keyA = caseA ? pathKey(caseA.id, seriesA) : null;
  const keyB = caseB ? pathKey(caseB.id, seriesB) : null;
  const urlA = caseA ? pathUrl(caseA.id, { series: seriesA }) : null;
  const urlB = caseB ? pathUrl(caseB.id, { series: seriesB }) : null;
  const ownKeyA = caseA ? pathKey(caseA.id, "own") : null;
  const ownKeyB = caseB ? pathKey(caseB.id, "own") : null;

  const paths = useSyncExternalStore(pathStore.subscribe, pathStore.snapshot, getEmptyMap);
  const entryA = keyA ? paths.get(keyA) : undefined;
  const entryB = keyB ? paths.get(keyB) : undefined;

  // One request per side, aborted when that side changes.
  useEffect(() => {
    if (!keyA || pathStore.has(keyA) || pathStore.pending(keyA)) return undefined;
    const controller = new AbortController();
    pathStore.load(keyA, urlA, controller.signal);
    return () => controller.abort();
  }, [keyA, urlA, attempts.a]);

  useEffect(() => {
    if (!keyB || pathStore.has(keyB) || pathStore.pending(keyB)) return undefined;
    const controller = new AbortController();
    pathStore.load(keyB, urlB, controller.signal);
    return () => controller.abort();
  }, [keyB, urlB, attempts.b]);

  // Shareable state, without filling the history.
  useEffect(() => {
    if (!sel || sel.source !== "user") return;
    const params = new URLSearchParams();
    params.set("a", sel.a);
    params.set("b", sel.b);
    params.set("series", sel.series);
    params.set("span", sel.span);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [sel]);

  // Cheap derivations, recomputed per render (the page does not re-render on
  // hover: the chart keeps its crosshair to itself).
  const lane = caseA && caseB ? chooseLaneMeasure(caseA, caseB, coverage ?? {}) : null;

  const pathA = entryA?.status === "ready" ? entryA.data : null;
  const pathB = entryB?.status === "ready" ? entryB.data : null;
  // Both requests have finished (a failed side is left out of the sentence).
  const pathsIn = Boolean(entryA && entryB);
  const readKey = sel ? `${sel.a}|${sel.b}|${series}` : "";

  // The read for the current selection. Own market needs only the
  // catalogue; another series needs both paths (a side still loading gets a
  // placeholder of the same shape, which only sizes the hidden copy below).
  let current = null;
  if (caseA && caseB) {
    const description = describePair(caseA, caseB, {
      series,
      paths: { a: pathA, b: pathB },
      coverage: coverage ?? {},
      status: { a: entryA?.status ?? "loading", b: entryB?.status ?? "loading" },
    });
    current = {
      tokens: description.tokens,
      footing: series === "own" ? footingLine(caseA, caseB) : null,
    };
  }
  const complete = Boolean(current) && (series === "own" || pathsIn);
  // After a pick, the read keeps the previous pair until both paths are in
  // (UX §7). The page takes the new read's height at once (an invisible
  // in-flow copy sizes the box), so the late swap moves nothing.
  const holding = Boolean(held?.content && held.key === readKey && !pathsIn);
  const shown = holding ? held.content : complete ? current : null;
  const covered = holding || !complete;
  const shownKey = `${readKey}|${covered ? "wait" : "read"}`;
  const holdFor = (key) => setHeld({ key, content: shown });

  const announce = useCallback((text) => {
    setAnnouncement((previous) => ({ text, n: previous.n + 1 }));
  }, []);

  const applySelection = (next, changed, messages = []) => {
    if (!sel) return;
    let selection = { ...sel, ...next, source: "user" };
    const nextA = byId.get(selection.a);
    const nextB = byId.get(selection.b);
    const notes = [...messages];
    if (
      selection.series !== "own" &&
      !seriesAvailability(nextA, nextB, selection.series, coverage ?? {}).ok
    ) {
      selection = { ...selection, series: "own" };
      notes.push("Series reset to own market.");
    }
    holdFor(`${selection.a}|${selection.b}|${selection.series}`);
    setSel(selection);
    setSeriesNote(null);
    if (changed.length) {
      setDrawTokens((previous) => {
        const tokens = { ...previous };
        for (const key of changed) tokens[key] = previous[key] + 1;
        return tokens;
      });
    }
    if (notes.length) announce(notes.join(" "));
  };

  const chooseCase = (side, id) => {
    if (!sel || sel[side] === id) return;
    const other = side === "a" ? "b" : "a";
    if (sel[other] === id) {
      applySelection({ a: sel.b, b: sel.a }, [], ["Swapped A and B."]);
      return;
    }
    applySelection({ [side]: id }, [side]);
  };

  const choosePair = ([a, b]) => {
    if (!sel) return;
    if (sel.a === b && sel.b === a) {
      applySelection({ a, b }, [], ["Swapped A and B."]);
      return;
    }
    const changed = [];
    if (sel.a !== a) changed.push("a");
    if (sel.b !== b) changed.push("b");
    applySelection({ a, b }, changed);
  };

  const swap = () => {
    if (!sel) return;
    applySelection({ a: sel.b, b: sel.a }, [], ["Swapped A and B."]);
  };

  // Prefetch what choosing the active option will show: the current series
  // when the case has it, else its own market (choosing it resets Series).
  const handlePreview = useCallback(
    (id) => {
      window.clearTimeout(previewTimer.current);
      if (!id) return;
      previewTimer.current = window.setTimeout(() => {
        const c = byId.get(id);
        if (!c) return;
        const has =
          series === "own" ||
          c.series?.key === series ||
          (c.series_available ?? []).includes(series);
        const want = has ? requestSeries(c, series) : "own";
        const key = pathKey(c.id, want);
        if (pathStore.has(key) || pathStore.pending(key)) return;
        pathStore.load(key, pathUrl(c.id, { series: want }));
      }, 150);
    },
    [byId, series],
  );

  const seriesOptions = SERIES_OPTIONS.map((option) => {
    const availability =
      caseA && caseB
        ? seriesAvailability(caseA, caseB, option.key, coverage ?? {})
        : { ok: true, reason: null };
    const asset = ASSET_TARGETS[option.key];
    return {
      ...option,
      ok: availability.ok,
      reason: availability.reason,
      color: asset ? { light: asset.light, dark: asset.dark } : null,
    };
  });

  const retrySide = (side) => {
    const key = side === "a" ? keyA : keyB;
    // The read keeps what it shows until the retried path is in.
    holdFor(readKey);
    if (key) pathStore.drop(key);
    setAttempts((previous) => ({ ...previous, [side]: previous[side] + 1 }));
  };

  const sideSpec = (key, c, entry) => ({
    key,
    letter: key.toUpperCase(),
    short: c.short_name,
    status: entry ? entry.status : "loading",
    path: entry?.status === "ready" ? entry.data : null,
    error: entry?.status === "error" ? entry.error : null,
    onRetry: () => retrySide(key),
    low: { d: c.days_to_trough, v: c.depth_pct, open: isOpen(c) },
    recovery: Number.isFinite(c.days_to_recovery) ? { d: c.days_to_recovery } : null,
    stop: series === "own" ? lineStop(c, span) : null,
    events: c.events ?? [],
    recessions: recessionsFor(c, recessionsById),
    drawToken: drawTokens[key],
    // The lane's rest readout uses the case's own readings (as the ledger does).
    laneAt:
      lane?.key === "ms"
        ? { peak: c.macro_strength?.at_peak?.value ?? null, low: c.macro_strength?.at_trough?.value ?? null }
        : { peak: c.core_index?.at_peak ?? null, low: c.core_index?.at_trough ?? null },
  });
  const chartSides =
    caseA && caseB ? [sideSpec("a", caseA, entryA), sideSpec("b", caseB, entryB)] : null;

  const domain =
    caseA && caseB ? [0, spanEnd(caseA, caseB, span, data?.as_of)] : [0, 45];

  const pairs = data?.pairs ?? [];
  const ready = catalogue.status === "ready" && caseA && caseB;
  const ownPaths = {
    a: ownKeyA ? paths.get(ownKeyA)?.data ?? null : null,
    b: ownKeyB ? paths.get(ownKeyB)?.data ?? null : null,
  };

  return (
    // Scroll padding clears the header and the stuck compare bar (66 px), so
    // a focused control is never hidden under them.
    <main
      ref={mainRef}
      className="relative h-full w-full scroll-pt-[calc(var(--sh-header-clear)+4.75rem)] overflow-y-auto overflow-x-hidden pb-24 pt-(--sh-header-clear)"
    >
      {/* While the bar is stuck, the sky closes over everything above its
          top edge (the header's scrim covers the rest), so no text shows in
          the band between the header and the bar. Painted like the scrim:
          the engine sky at the viewport's origin, the scrollbar left clear. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-0 right-[var(--cv-gutter,0px)] top-0 z-[29] hidden h-(--sh-header-clear) [[data-cv-stuck]_&]:block"
        style={{ background: "var(--sh-engine-sky) 0 0 / 100vw 100dvh no-repeat" }}
      />
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-micro uppercase tracking-[0.2em] text-[#a83a27] dark:text-[#ff8b77]">
              Convergence
            </p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl">
              Two events. One macro lens.
            </h1>
            <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/70 dark:text-white/70 sm:text-body">
              Put any two market declines side by side: the fall from each
              peak, the macro reading on the same days and the Sun / Moon /
              Saturn ephemeris. The astro layer is a historical lens, not a
              forecast.
            </p>
          </div>
          <p className="min-h-[1.35em] whitespace-nowrap font-mono text-micro text-(--sh-text-3)">
            {data ? `${data.counts?.total ?? data.cases.length} cases · data to ${formatCaseDate(data.as_of)}` : ""}
          </p>
        </header>

        {catalogue.status === "error" ? (
          <div className="mt-6 rounded-[1.6rem] border border-[#ef4444]/20 bg-white/45 p-5 dark:border-[#ef4444]/25 dark:bg-black/40 sm:p-6">
            <p className="text-micro uppercase tracking-[0.16em] text-[#c0442f] dark:text-[#ff8b77]">
              Event archive offline
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
              Could not load the convergence windows.
            </h2>
            <p className="mt-2 text-meta text-black/70 dark:text-white/70">{catalogue.error}</p>
            <button
              type="button"
              onClick={() => {
                setCatalogue({ status: "loading", data: null, error: null });
                setReloadKey((key) => key + 1);
              }}
              className="mt-4 rounded-full border border-black/14 px-3.5 py-1.5 text-micro font-medium text-black/70 transition-colors hover:bg-black/4 focus-visible:bg-black/4 pointer-coarse:min-h-11 dark:border-white/14 dark:text-white/70 dark:hover:bg-white/6 dark:focus-visible:bg-white/6"
            >
              Retry event archive
            </button>
          </div>
        ) : null}

        {catalogue.status !== "error" ? (
          <>
            {/* The comparison bar: Compare + Swap | A | B. Sticky offsets are
                measured from <main>'s content box, which already starts at the
                header clearance, so top-0 holds it just under the brand row.
                The blur sits on a square layer behind the rounded bar (FROST),
                so text passing under the bar's corners is frosted too. */}
            <div ref={barRef} className="sticky top-0 z-30 mt-5">
              <div aria-hidden="true" className={FROST} />
              <div className="relative rounded-[1.25rem] border border-(--sh-line-1) bg-(--sh-surface-float) p-1.5 sm:py-2 sm:pl-4 sm:pr-3">
                <div className={`${GRID} items-center`}>
                  <div className="hidden flex-wrap items-center justify-between gap-2 sm:flex">
                    <span className={CAPS}>Compare</span>
                    <button
                      type="button"
                      onClick={swap}
                      disabled={!ready}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-(--sh-line-1) px-3 text-micro font-medium pointer-coarse:min-h-11 text-(--sh-text-2) transition-colors duration-(--sh-dur-micro) hover:bg-(--sh-hover) hover:text-[#14121a] focus-visible:bg-(--sh-hover) focus-visible:text-[#14121a] disabled:opacity-60 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4]"
                    >
                      <SwapIcon className="h-[13px] w-[13px]" />
                      Swap sides
                    </button>
                  </div>
                  <div className={COL_A}>
                    {ready ? (
                      <CasePicker
                        side="a"
                        label="Case A"
                        value={sel.a}
                        otherValue={sel.b}
                        cases={data.cases}
                        kinds={data.kinds}
                        recessions={data.recessions}
                        pairs={pairs}
                        seriesKey={series}
                        coverage={coverage}
                        onChange={(id) => chooseCase("a", id)}
                        onPair={choosePair}
                        onPreview={handlePreview}
                      />
                    ) : (
                      <CaseTriggerPlaceholder side="a" />
                    )}
                  </div>
                  <div className="col-start-2 flex justify-center sm:hidden">
                    <button
                      type="button"
                      onClick={swap}
                      disabled={!ready}
                      aria-label="Swap A and B"
                      className="grid h-11 w-11 place-items-center rounded-full text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) disabled:opacity-60"
                    >
                      <SwapIcon className="h-[15px] w-[15px]" />
                    </button>
                  </div>
                  <div className={COL_B}>
                    {ready ? (
                      <CasePicker
                        side="b"
                        label="Case B"
                        value={sel.b}
                        otherValue={sel.a}
                        cases={data.cases}
                        kinds={data.kinds}
                        recessions={data.recessions}
                        pairs={pairs}
                        seriesKey={series}
                        coverage={coverage}
                        onChange={(id) => chooseCase("b", id)}
                        onPair={choosePair}
                        onPreview={handlePreview}
                      />
                    ) : (
                      <CaseTriggerPlaceholder side="b" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Everything under the bar mounts afresh when the catalogue
                arrives: new nodes are not layout shifts, so a shared link
                whose read runs to five lines loads without moving the page. */}
            <Fragment key={ready ? "ready" : "wait"}>
              {note ? (
                <div role="status" className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-micro text-(--sh-text-2)">
                  <span>{note}</span>
                  <button type="button" onClick={() => setNote(null)} className={QUIET_LINK}>
                    Dismiss
                  </button>
                </div>
              ) : null}

              <section aria-labelledby="cv-read-title" className="mt-5">
                <h2 id="cv-read-title" className="text-micro uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
                  Convergence read
                </h2>
                {/* Reserved lines follow the measured sentences: 3 below 640 px
                    (4 below 380), 3 to 1023 px, 2 from 1024. While a pick holds
                    the previous read, the new one sits invisible in the flow
                    (so the box has its final height on the click) and the held
                    text covers it; every change mounts new text nodes. */}
                <p
                  aria-live="polite"
                  aria-atomic="true"
                  className="relative mt-1.5 min-h-[4.65em] max-w-[62rem] text-strong leading-[1.55] tracking-[-0.005em] text-(--sh-text-1) max-[379px]:min-h-[6.2em] sm:text-[1.0625rem] lg:min-h-[3.1em]"
                >
                  {current ? (
                    <span key={shownKey} className={covered ? "invisible" : undefined}>
                      <Sentence tokens={current.tokens} />
                    </span>
                  ) : null}
                  {holding ? (
                    <span key={held.key} aria-hidden="true" className="absolute inset-0 overflow-hidden">
                      <Sentence tokens={held.content.tokens} />
                    </span>
                  ) : null}
                  {!shown ? (
                    <span className="absolute inset-0">
                      <span className="block h-[1.1em] w-11/12 max-w-[46rem] rounded bg-(--sh-hover)" aria-hidden="true" />
                      <span className="mt-[0.45em] block h-[1.1em] w-7/12 max-w-[30rem] rounded bg-(--sh-hover)" aria-hidden="true" />
                      <span className="sr-only">Loading cases</span>
                    </span>
                  ) : null}
                </p>
                {/* The footing takes a line only when the pair has one: it is known
                    at the pick (catalogue only) and enters the flow then, inside
                    the input window, so an empty pair keeps no blank line. */}
                <p className="relative mt-1 text-micro text-(--sh-text-3)">
                  {current?.footing ? (
                    <span key={shownKey} className={covered ? "invisible" : undefined}>
                      {current.footing}
                    </span>
                  ) : null}
                  {holding && held.content.footing ? (
                    <span key={held.key} aria-hidden="true" className="absolute inset-0 overflow-hidden">
                      {held.content.footing}
                    </span>
                  ) : null}
                </p>
                {/* Phones: one row that scrolls sideways (the last pair fades
                    at the edge); from 640 px one line with separators, each
                    kept with the pair it follows. */}
                <div className="mt-1.5 flex items-center text-micro text-(--sh-text-3) max-sm:min-h-8 sm:min-h-8 pointer-coarse:min-h-11">
                  <span className={`mr-1.5 shrink-0 ${CAPS}`}>Pairs</span>
                  <p className="flex min-w-0 items-center gap-x-1 max-sm:-my-1 max-sm:gap-x-2 max-sm:overflow-x-auto max-sm:py-1 max-sm:pr-6 max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-1.5rem),transparent)] max-sm:[scrollbar-width:none] sm:flex-wrap sm:gap-y-0.5 max-sm:[&::-webkit-scrollbar]:hidden">
                    {ready
                      ? pairs.slice(0, 3).map((pair, index) => {
                          const a = byId.get(pair.a);
                          const b = byId.get(pair.b);
                          if (!a || !b) return null;
                          return (
                            <span key={`${pair.a}-${pair.b}`} className="inline-flex shrink-0 items-center gap-x-1 whitespace-nowrap">
                              {index > 0 ? (
                                <span className="text-(--sh-text-4) max-sm:hidden" aria-hidden="true">
                                  ·
                                </span>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => choosePair([pair.a, pair.b])}
                                title={`${a.name} · ${b.name}`}
                                className="rounded-lg px-1.5 py-1 text-(--sh-text-2) underline decoration-(--sh-line-2) underline-offset-4 transition-colors duration-(--sh-dur-micro) hover:text-[#14121a] hover:decoration-[#f05d49] focus-visible:text-[#14121a] focus-visible:decoration-[#f05d49] pointer-coarse:min-h-11 dark:hover:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:text-[#f2ede4] dark:focus-visible:decoration-[#ff8b77]"
                              >
                                {a.short_name} vs {b.short_name}
                              </button>
                            </span>
                          );
                        })
                      : null}
                  </p>
                </div>
              </section>

              <section aria-label="Paths from each peak" className={`${CARD} mt-4 px-3.5 pb-2.5 pt-3.5 sm:px-6 sm:pb-3.5 sm:pt-5`}>
                <AlignedPathsChart
                  sides={
                    chartSides ?? [
                      { key: "a", letter: "A", short: "case A", status: "loading", path: null },
                      { key: "b", letter: "B", short: "case B", status: "loading", path: null },
                    ]
                  }
                  domain={domain}
                  zeroLabel="peak"
                  markers={series === "own"}
                  lane={lane ?? { key: "ci", label: "Core Index", notes: { a: null, b: null } }}
                  laneDefinition={lane?.key === "ms" ? MACRO_DEFINITION : CORE_INDEX_DEFINITION}
                  ariaLabel={
                    caseA && caseB
                      ? `Change from each peak: ${caseA.name} (A) and ${caseB.name} (B).`
                      : "Change from each peak."
                  }
                  scrubLabel="Day from peak"
                  gapNote={
                    coverage?.equity_gap?.end
                      ? `no equity data to ${formatMonth(coverage.equity_gap.end)}`
                      : null
                  }
                  onDayChange={dayStore.set}
                  controls={
                    <div className={`flex items-center gap-2 sm:flex-wrap sm:justify-end ${ready ? "" : "pointer-events-none opacity-60"}`} inert={ready ? undefined : true}>
                      <SegmentedRadio
                        label="Span"
                        value={span}
                        options={SPANS}
                        onChange={(next) => {
                          if (!sel || next === span) return;
                          setSel({ ...sel, span: next, source: "user" });
                        }}
                      />
                      <SeriesControl
                        value={series}
                        options={seriesOptions}
                        onChange={(next) => {
                          if (!sel || next === series) return;
                          const option = seriesOptions.find((item) => item.key === next);
                          if (option && !option.ok) {
                            setSeriesNote(option.reason);
                            announce(option.reason);
                            return;
                          }
                          setSeriesNote(null);
                          holdFor(`${sel.a}|${sel.b}|${next}`);
                          setSel({ ...sel, series: next, source: "user" });
                        }}
                        onBlocked={(reason) => {
                          setSeriesNote(reason);
                          announce(reason);
                        }}
                      />
                    </div>
                  }
                  note={
                    seriesNote ? (
                      <p className="text-micro text-(--sh-text-3) xl:text-right">{seriesNote}</p>
                    ) : null
                  }
                />
              </section>

              {ready ? (
                <>
                  <Ledger
                    caseA={caseA}
                    caseB={caseB}
                    kindLabels={kindLabels}
                    recessionsById={recessionsById}
                    coverage={coverage}
                    laneKey={lane?.key ?? "ci"}
                    ownPaths={ownPaths}
                  />
                  <SkySection caseA={caseA} caseB={caseB} domainEnd={domain[1]} dayStore={dayStore} coverage={coverage} series={series} />
                  <MethodDetails data={data} />
                </>
              ) : null}
            </Fragment>
          </>
        ) : null}

        {catalogue.status !== "loading" ? (
          <div className="mt-4 flex justify-end gap-4">
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new Event("strikehike:show-onboarding"))
              }
              className={QUIET_LINK}
            >
              How it works
            </button>
            <Link href="/disclaimer" className={QUIET_LINK}>
              Disclaimer
            </Link>
          </div>
        ) : null}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement.text}
        {announcement.n % 2 ? "​" : ""}
      </p>
      <OnboardingModal />
    </main>
  );
}
