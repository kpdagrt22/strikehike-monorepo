"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import crashMarkers from "@/data/astro/crash_markers.json";
import { DateTimePicker } from "@/components/DateTimePicker";
import { categoryTone } from "@/lib/categoryTone";
import { namedTithi } from "@/lib/tithi";
import {
  TIMELINE_MAX,
  TIMELINE_MIN,
  currentUtcDate,
  useChronoStore,
} from "@/store/chronoStore";

const DAY_MS = 86_400_000;
const MIN_MS = Date.parse(`${TIMELINE_MIN}T00:00:00Z`);
const MAX_MS = Date.parse(`${TIMELINE_MAX}T00:00:00Z`);
const TOTAL_DAYS = Math.round((MAX_MS - MIN_MS) / DAY_MS);
const START_YEAR = TIMELINE_MIN.slice(0, 4);
const END_YEAR = TIMELINE_MAX.slice(0, 4);

// Crash markers in timeline order, for Page Up / Page Down jumps on the range.
const MARKERS_IN_ORDER = crashMarkers.markers
  .map((marker) => ({ ...marker, value: dateToValue(marker.date) }))
  .sort((a, b) => a.value - b.value);
const MARKER_BY_DATE = new Map(
  crashMarkers.markers.map((marker) => [marker.date, marker]),
);

function adjacentMarker(value, direction) {
  if (direction > 0) {
    return MARKERS_IN_ORDER.find((marker) => marker.value > value) ?? null;
  }
  for (let index = MARKERS_IN_ORDER.length - 1; index >= 0; index -= 1) {
    if (MARKERS_IN_ORDER[index].value < value) return MARKERS_IN_ORDER[index];
  }
  return null;
}

const EDGE_FADE =
  "transition-opacity duration-200 motion-reduce:transition-none";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function formatDate(iso) {
  return dateFormatter.format(new Date(`${iso}T00:00:00Z`));
}

function formatDateTime(iso, time) {
  if (!time || time === "00:00") return formatDate(iso);
  const label = timeFormatter.format(new Date(`${iso}T${time}:00Z`));
  return `${formatDate(iso)} · ${label} UTC`;
}

function dateToValue(iso) {
  const value = Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - MIN_MS) / DAY_MS,
  );
  return Math.max(0, Math.min(TOTAL_DAYS, value));
}

function valueToDate(value) {
  const clamped = Math.max(0, Math.min(TOTAL_DAYS, value));
  return new Date(MIN_MS + clamped * DAY_MS).toISOString().slice(0, 10);
}

// Static per marker: track position and labels, formatted once rather than on
// every scrub step.
const MARKERS = crashMarkers.markers.map((marker) => ({
  ...marker,
  left: Math.min(
    99.5,
    Math.max(0.5, (dateToValue(marker.date) / TOTAL_DAYS) * 100),
  ),
  title: `${marker.name} · ${formatDate(marker.date)}`,
  label: `${marker.name}, ${formatDate(marker.date)}`,
}));

// Memoised: while scrubbing it only re-renders when the focused date lands on
// or leaves one of its own dates.
const FutureLane = memo(function FutureLane({
  matches,
  status,
  activeDate,
  onSelect,
}) {
  const today = currentUtcDate();
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const futureMatches = matches
    .map((match) => {
      const daysAhead = Math.round(
        (Date.parse(`${match.date}T00:00:00Z`) - todayMs) / DAY_MS,
      );
      return { ...match, daysAhead };
    })
    .filter(
      (match) =>
        Number.isFinite(match.daysAhead) &&
        match.daysAhead >= 0 &&
        match.daysAhead <= 180,
    )
    .sort((a, b) => a.daysAhead - b.daysAhead)
    .slice(0, 5);

  const loading = status === "idle" || status === "loading";
  const error = status === "error";

  return (
    <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
      <div className="flex items-center justify-between gap-3 text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
        <span>Next 180 days</span>
        <span>
          {error
            ? "Unavailable"
            : loading
              ? "Loading"
              : `${futureMatches.length} plotted`}
        </span>
      </div>

      {error ? (
        <p className="mt-2 text-meta text-black/60 dark:text-white/60">
          Upcoming events are unavailable.
        </p>
      ) : loading ? (
        <div className="mt-2 h-10 animate-pulse rounded-full bg-black/[0.05] dark:bg-white/[0.06]" />
      ) : futureMatches.length === 0 ? (
        <p className="mt-2 text-meta text-black/60 dark:text-white/60">
          No events in the next 180 days.
        </p>
      ) : (
        <div className="relative mt-2 h-[4.25rem]">
          <div className="absolute inset-x-0 top-4 h-px bg-black/15 dark:bg-white/15" />
          {/* A neutral line drawn with scaleX: a transform, never a width. */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            style={{ originX: 0 }}
            className="absolute inset-x-0 top-4 h-px bg-black/30 dark:bg-white/30"
          />

          {futureMatches.map((match, index) => {
            const tone = categoryTone(match.event.category);
            const left = Math.max(
              6,
              Math.min(94, (match.daysAhead / 180) * 100),
            );
            const active = activeDate === match.date;
            const lane = index % 2 === 0 ? "top-0" : "top-8";

            return (
              <motion.button
                key={`${match.date}-${match.event.name}`}
                type="button"
                onClick={() => onSelect(match.date)}
                title={`${match.event.name} · ${formatDate(match.date)}`}
                aria-label={`+${match.daysAhead}d — ${match.event.name}, ${formatDate(match.date)}`}
                aria-pressed={active}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  delay: 0.06 + index * 0.05,
                  duration: 0.2,
                  ease: [0.22, 1, 0.36, 1],
                }}
                style={{ left: `${left}%` }}
                className={`absolute ${lane} z-10 flex -translate-x-1/2 flex-col items-center`}
              >
                <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                  <span
                    className={`relative h-2.5 w-2.5 rounded-full border ${
                      active
                        ? "border-[#14121a] dark:border-[#f2ede4]"
                        : "border-black/20 dark:border-white/30"
                    }`}
                    style={{ backgroundColor: tone.color }}
                  />
                </span>
                <span className="mt-1 whitespace-nowrap text-micro font-medium tabular-nums text-black/60 dark:text-white/60">
                  +{match.daysAhead}d
                </span>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export function TimeControls() {
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const focusedTime = useChronoStore((state) => state.focusedTime);
  const setFocusedDate = useChronoStore((state) => state.setFocusedDate);
  const setFocusedDateTime = useChronoStore(
    (state) => state.setFocusedDateTime,
  );
  const setPositions = useChronoStore((state) => state.setPositions);
  const setStatus = useChronoStore((state) => state.setStatus);
  const setTimeControlsExpanded = useChronoStore(
    (state) => state.setTimeControlsExpanded,
  );
  const setMobileSheet = useChronoStore((state) => state.setMobileSheet);
  const status = useChronoStore((state) => state.status);
  const source = useChronoStore((state) => state.source);
  const positions = useChronoStore((state) => state.positions);
  const positionsDateTime = useChronoStore((state) => state.positionsDateTime);
  const positionsRetryKey = useChronoStore(
    (state) => state.positionsRetryKey,
  );
  const ladderMatches = useChronoStore((state) => state.ladderMatches);
  const ladderStatus = useChronoStore((state) => state.ladderStatus);

  const [expanded, setExpanded] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const selectedDateTime = `${focusedDate}T${focusedTime}`;

  const closePicker = useCallback(() => setPickerOpen(false), []);
  const applyPicker = useCallback(
    (date, time) => {
      setFocusedDateTime(date, time);
      setPickerOpen(false);
    },
    [setFocusedDateTime],
  );
  const today = currentUtcDate();
  const isToday = focusedDate === today && focusedTime === "00:00";

  useEffect(() => {
    setTimeControlsExpanded(expanded);
    // The expanded tray owns the bottom of the screen; close any mobile sheet
    // underneath it so the two surfaces never compete for the same space.
    if (expanded) setMobileSheet(null);
    return () => setTimeControlsExpanded(false);
  }, [expanded, setMobileSheet, setTimeControlsExpanded]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");

      try {
        const response = await fetch(
          `/api/chrono/positions?datetime=${encodeURIComponent(selectedDateTime)}`,
          { signal: controller.signal },
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const payload = await response.json();
        setPositions(payload);
      } catch (error) {
        if (error.name !== "AbortError") setStatus("error");
      }
    }, 140);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedDateTime, positionsRetryKey, setPositions, setStatus]);

  useEffect(() => {
    if (!scrubbing) return;

    const stop = () => setScrubbing(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);

    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [scrubbing]);

  const value = dateToValue(focusedDate);
  const progress = (value / TOTAL_DAYS) * 100;
  const dateTimeLabel = formatDateTime(focusedDate, focusedTime);

  // Easter egg "Tithi moon": Purnima or Amavasya at the focused moment, from
  // the Sun and Moon longitudes of positions that describe exactly it.
  const tithi =
    status === "ready" && positionsDateTime === selectedDateTime
      ? namedTithi(positions)
      : null;
  const tithiLine = tithi ? `${tithi} tithi at ${focusedTime} UTC` : null;

  // Easter egg "Edge of time": the first and last day of the engine's range.
  const atStart = focusedDate === TIMELINE_MIN;
  const atEnd = focusedDate === TIMELINE_MAX;
  // An error label always wins over the egg.
  const edgeShown = (atStart || atEnd) && status !== "error";
  const markerHere = MARKER_BY_DATE.get(focusedDate);
  const valueText = [
    formatDate(focusedDate),
    markerHere?.name,
    atStart
      ? "start of the timeline"
      : atEnd
        ? "end of the timeline"
        : null,
  ]
    .filter(Boolean)
    .join(", ");

  const onRangeKeyDown = (event) => {
    if (event.key !== "PageUp" && event.key !== "PageDown") return;
    event.preventDefault();
    const marker = adjacentMarker(value, event.key === "PageUp" ? 1 : -1);
    if (marker) setFocusedDate(marker.date);
  };

  // Pointer shortcuts only: keyboard users jump between markers with Page Up /
  // Page Down on the range. The marker under the thumb lets the pointer
  // through so the thumb can be dragged from there. Rebuilt only when the
  // focused date lands on or leaves a marker, not on every scrub step.
  const hereDate = markerHere ? focusedDate : null;
  const markerButtons = useMemo(
    () =>
      MARKERS.map((marker) => (
        <button
          key={marker.date}
          type="button"
          tabIndex={-1}
          onClick={() => setFocusedDate(marker.date)}
          style={{ left: `${marker.left}%` }}
          title={marker.title}
          aria-label={marker.label}
          className={`group absolute top-1/2 z-20 grid h-11 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center ${
            marker.date === hereDate ? "pointer-events-none" : ""
          }`}
        >
          <span className="grid h-4 w-4 place-items-center rounded-full transition-colors duration-[140ms] group-hover:bg-black/[0.08] dark:group-hover:bg-white/[0.12]">
            <span
              className={`block rounded-full ${
                marker.major
                  ? "h-1.5 w-1.5 bg-[#f05d49]"
                  : "h-1 w-1 bg-black/35 dark:bg-white/35"
              }`}
            />
          </span>
        </button>
      )),
    [hereDate, setFocusedDate],
  );

  const laneActiveDate = ladderMatches.some(
    (match) => match.date === focusedDate,
  )
    ? focusedDate
    : null;

  const statusLabel =
    status === "loading"
      ? "Reading sky"
      : status === "error"
        ? "Ephemeris unavailable"
        : source
          ? "Swiss Ephemeris · Lahiri"
          : "Initialising";

  return (
    <>
      <motion.div
        layout
        layoutDependency={expanded}
        onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => {
        if (!scrubbing && !pickerOpen) setExpanded(false);
      }}
      // An open dock sheet follows the tray in the DOM: keyboard focus passing
      // through must not expand the tray, which would close that sheet.
      onFocusCapture={() => {
        if (!useChronoStore.getState().mobileSheet) setExpanded(true);
      }}
      onBlurCapture={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !pickerOpen
        ) {
          setExpanded(false);
        }
      }}
      transition={{ layout: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } }}
      className={`pointer-events-auto fixed bottom-3 left-1/2 z-30 -translate-x-1/2 overflow-hidden rounded-2xl border border-black/10 bg-white/40 shadow-[0_18px_60px_rgba(20,18,26,0.16)] backdrop-blur-md backdrop-saturate-150 sm:bottom-5 dark:border-white/15 dark:bg-white/10 dark:shadow-[0_18px_60px_rgba(0,0,0,0.55)] ${
        expanded
          ? "w-[min(44rem,calc(100vw-1.5rem))]"
          : "w-auto"
      }`}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={expanded}
          aria-controls={expanded ? "chrono-timeline-controls" : undefined}
          // Name follows the on-screen reading order (label, tithi, date), so
          // the visible text is always contained in it.
          aria-label={`Focused date: ${
            tithiLine ? `${tithiLine}, ` : ""
          }${dateTimeLabel}. Open timeline.`}
          // Expanded on phones, the label takes the row beside the dot and the
          // date wraps beneath it, so the label never breaks onto two lines.
          // The tray clips overflow, so the focus ring is drawn inset.
          className={`flex min-h-11 flex-1 items-center gap-2.5 rounded-xl px-4 py-2.5 text-left focus-visible:outline-offset-[-3px] ${
            expanded ? "max-sm:flex-wrap max-sm:gap-y-1" : ""
          }`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full bg-[#f05d49] ${
              status === "loading" ? "animate-pulse" : ""
            }`}
          />

          {expanded ? (
            <span className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60 max-sm:basis-[calc(100%-1rem)]">
              Focused date
              {tithiLine ? ` · ${tithiLine}` : null}
            </span>
          ) : null}{" "}
          <span className="ml-auto whitespace-nowrap text-strong font-medium tabular-nums tracking-[-0.01em] text-[#14121a] dark:text-[#f2ede4]">
            {dateTimeLabel}
          </span>
          {/* Reserved 8px slot so the glyph never shifts the pill: a disc for
              Purnima, a hairline ring for Amavasya, nothing on other days. */}
          <span
            aria-hidden="true"
            data-egg="tithi-moon"
            data-tithi={tithi ? tithi.toLowerCase() : undefined}
            className={`-ml-1 h-2 w-2 shrink-0 rounded-full ${
              tithi === "Purnima"
                ? "bg-[#14121a] dark:bg-[#f2ede4]"
                : tithi === "Amavasya"
                  ? "border border-[#14121a]/70 dark:border-[#f2ede4]/70"
                  : ""
            }`}
          />
        </button>

        <span className="my-2 w-px shrink-0 bg-black/10 dark:bg-white/10" />

        <button
          type="button"
          onClick={() => setFocusedDateTime(currentUtcDate(), "00:00")}
          aria-label="Jump to today's UTC date"
          aria-current={isToday ? "date" : undefined}
          className="group flex min-h-11 shrink-0 items-center px-1.5 focus-visible:outline-none"
        >
          <span
            className={`flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-micro font-medium uppercase tracking-[0.14em] transition-colors duration-[140ms] group-focus-visible:ring-2 group-focus-visible:ring-(--sh-focus) ${
              isToday
                ? "bg-black/[0.07] text-[#14121a] dark:bg-white/[0.08] dark:text-[#f2ede4]"
                : "text-black/60 group-hover:bg-black/[0.04] group-hover:text-[#14121a] group-focus-visible:bg-black/[0.04] dark:text-white/60 dark:group-hover:bg-white/[0.06] dark:group-hover:text-[#f2ede4] dark:group-focus-visible:bg-white/[0.06]"
            }`}
          >
            <span
              className={`h-1 w-1 rounded-full ${
                isToday ? "bg-current" : "ring-1 ring-current"
              }`}
            />
            Today
          </span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id="chrono-timeline-controls"
            key="controls"
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: "auto",
              opacity: 1,
              transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
            }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">
              <div className="relative h-11">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/15 dark:bg-white/15" />
                {/* Neutral progress, drawn with scaleX so scrubbing never
                    touches layout. Red stays with the thumb and major crashes. */}
                <div
                  className="absolute inset-x-0 top-1/2 h-px origin-left bg-black/35 dark:bg-white/35"
                  style={{
                    transform: `translateY(-50%) scaleX(${progress / 100})`,
                  }}
                />

                {markerButtons}

                <input
                  type="range"
                  min={0}
                  max={TOTAL_DAYS}
                  step={1}
                  value={value}
                  onChange={(event) =>
                    setFocusedDate(valueToDate(Number(event.target.value)))
                  }
                  onKeyDown={onRangeKeyDown}
                  onPointerDown={() => setScrubbing(true)}
                  onPointerUp={() => setScrubbing(false)}
                  onPointerCancel={() => setScrubbing(false)}
                  onBlur={() => setScrubbing(false)}
                  aria-label="Focused date"
                  aria-valuetext={valueText}
                  aria-describedby="chrono-range-hint"
                  className="chrono-range absolute inset-0 z-10 h-11 w-full cursor-ew-resize appearance-none bg-transparent"
                />
                <span id="chrono-range-hint" className="sr-only">
                  Page Up and Page Down jump between crash markers
                </span>
              </div>

              <div className="mt-2 flex items-center gap-2.5">
                <span className="whitespace-nowrap text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
                  Precise UTC
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(true);
                    setPickerOpen(true);
                  }}
                  aria-haspopup="dialog"
                  aria-expanded={pickerOpen}
                  aria-label={`Edit precise UTC date and time, ${dateTimeLabel}`}
                  className="group flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-black/10 bg-black/[0.025] py-1 pl-3 pr-2 text-left text-meta tabular-nums tracking-[-0.01em] text-black/70 outline-none transition-colors hover:bg-black/[0.04] focus-visible:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-(--sh-focus) sm:h-9 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5 shrink-0 text-black/60 dark:text-white/60"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.15"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
                    <path d="M5 2.5v2M11 2.5v2M2.5 6.5h11" />
                    <circle cx="5.2" cy="9.2" r="0.65" fill="currentColor" stroke="none" />
                    <circle cx="8" cy="9.2" r="0.65" fill="currentColor" stroke="none" />
                    <circle cx="10.8" cy="9.2" r="0.65" fill="currentColor" stroke="none" />
                  </svg>
                  <span className="truncate">{dateTimeLabel}</span>
                  {/* The visible verb is drawn as CSS content: the accessible
                      name already starts with "Edit", and the DOM text stays
                      the date alone, which the name contains. */}
                  <span
                    aria-hidden="true"
                    className="ml-auto shrink-0 text-micro font-medium uppercase tracking-[0.14em] text-black/60 transition-colors after:content-['Edit'] group-hover:text-[#14121a] dark:text-white/60 dark:group-hover:text-[#f2ede4]"
                  />
                </button>
              </div>

              {/* Edge of time: at the first or last day an end label extends
                  (200 ms crossfade, instant under reduced motion) while the
                  centre status steps aside, so nothing reflows. */}
              <div className="relative mt-2.5 flex items-center justify-between gap-3 text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
                <span
                  className={`${EDGE_FADE} ${
                    edgeShown && atStart ? "opacity-0" : ""
                  }`}
                >
                  {START_YEAR}
                </span>
                <span
                  className={`${EDGE_FADE} ${
                    status === "error"
                      ? "text-[#c0442f] dark:text-[#ff8b77]"
                      : ""
                  } ${edgeShown ? "opacity-0" : ""}`}
                >
                  {statusLabel}
                </span>
                <span
                  className={`${EDGE_FADE} ${
                    edgeShown && atEnd ? "opacity-0" : ""
                  }`}
                >
                  {END_YEAR}
                </span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-0 whitespace-nowrap ${EDGE_FADE} ${
                    edgeShown && atStart ? "" : "opacity-0"
                  }`}
                >
                  {`${START_YEAR} · where the timeline begins`}
                </span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute right-0 whitespace-nowrap ${EDGE_FADE} ${
                    edgeShown && atEnd ? "" : "opacity-0"
                  }`}
                >
                  {`${END_YEAR} · the engine's horizon`}
                </span>
              </div>

              <FutureLane
                matches={ladderMatches}
                status={ladderStatus}
                activeDate={laneActiveDate}
                onSelect={setFocusedDate}
              />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      </motion.div>

      <DateTimePicker
        open={pickerOpen}
        initialDate={focusedDate}
        initialTime={focusedTime}
        minDate={TIMELINE_MIN}
        maxDate={TIMELINE_MAX}
        onApply={applyPicker}
        onClose={closePicker}
      />
    </>
  );
}
