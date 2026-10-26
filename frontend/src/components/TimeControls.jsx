"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import crashMarkers from "@/data/astro/crash_markers.json";
import { DateTimePicker } from "@/components/DateTimePicker";
import { categoryTone } from "@/lib/categoryTone";
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

function FutureLane({ matches, status, focusedDate, onSelect }) {
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
      <div className="flex items-center justify-between gap-3 text-micro font-medium uppercase tracking-[0.1em] text-black/45 dark:text-white/40">
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
        <p className="mt-2 text-meta text-black/40 dark:text-white/40">
          Upcoming events are unavailable.
        </p>
      ) : loading ? (
        <div className="mt-2 h-10 animate-pulse rounded-full bg-black/[0.05] dark:bg-white/[0.06]" />
      ) : futureMatches.length === 0 ? (
        <p className="mt-2 text-meta text-black/40 dark:text-white/40">
          No events in the next 180 days.
        </p>
      ) : (
        <div className="relative mt-2 h-16">
          <div className="absolute inset-x-0 top-4 h-px bg-black/15 dark:bg-white/15" />
          <motion.div
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.15, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 top-4 h-px bg-[#f05d49] shadow-[0_0_10px_rgba(240,93,73,0.55)]"
          />

          {futureMatches.map((match, index) => {
            const tone = categoryTone(match.event.category);
            const left = Math.max(
              6,
              Math.min(94, (match.daysAhead / 180) * 100),
            );
            const active = focusedDate === match.date;
            const lane = index % 2 === 0 ? "top-0" : "top-8";

            return (
              <motion.button
                key={`${match.date}-${match.event.name}`}
                type="button"
                onClick={() => onSelect(match.date)}
                title={`${match.event.name} · ${formatDate(match.date)}`}
                aria-label={`${match.event.name}, ${formatDate(match.date)}`}
                aria-pressed={active}
                initial={{ opacity: 0, y: 7, scale: 0.75 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{
                  delay: 0.08 + index * 0.09,
                  duration: 0.32,
                  ease: [0.22, 1, 0.36, 1],
                }}
                style={{ left: `${left}%` }}
                className={`absolute ${lane} z-10 flex -translate-x-1/2 flex-col items-center`}
              >
                <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                  <motion.span
                    animate={{ scale: [1, 1.8], opacity: [0.4, 0] }}
                    transition={{
                      duration: 2.4,
                      repeat: Infinity,
                      delay: index * 0.25,
                      ease: "easeOut",
                    }}
                    className="absolute inset-0 rounded-full"
                    style={{ backgroundColor: tone.color }}
                  />
                  <span
                    className={`relative h-2.5 w-2.5 rounded-full border ${
                      active
                        ? "border-white/80"
                        : "border-black/20 dark:border-white/30"
                    }`}
                    style={{
                      backgroundColor: tone.color,
                      boxShadow: `0 0 9px ${tone.glow}`,
                    }}
                  />
                </span>
                <span className="mt-1 whitespace-nowrap text-[10px] font-medium tabular-nums text-black/50 dark:text-white/45">
                  +{match.daysAhead}d
                </span>
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  }, [selectedDateTime, setPositions, setStatus]);

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
        onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => {
        if (!scrubbing && !pickerOpen) setExpanded(false);
      }}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !pickerOpen
        ) {
          setExpanded(false);
        }
      }}
      transition={{ layout: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}
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
          aria-label={`Focused date: ${formatDateTime(focusedDate, focusedTime)}. Open timeline.`}
          className="flex min-h-11 flex-1 items-center gap-2.5 px-4 py-2.5 text-left"
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full bg-[#f05d49] ${
              status === "loading" ? "animate-pulse" : ""
            }`}
          />

          {expanded ? (
            <span className="text-micro font-medium uppercase tracking-[0.16em] text-black/55 dark:text-white/55">
              Focused date
            </span>
          ) : null}

          <span className="ml-auto whitespace-nowrap text-strong font-medium tabular-nums tracking-[-0.01em] text-[#14121a] dark:text-[#f2ede4]">
            {formatDateTime(focusedDate, focusedTime)}
          </span>
        </button>

        <span className="my-2 w-px shrink-0 bg-black/10 dark:bg-white/10" />

        <button
          type="button"
          onClick={() => setFocusedDateTime(currentUtcDate(), "00:00")}
          aria-label="Jump to today's UTC date"
          aria-current={isToday ? "date" : undefined}
          className={`flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-micro font-medium uppercase tracking-[0.1em] transition-colors ${
            isToday
              ? "text-[#c0442f] dark:text-[#ff8b77]"
              : "text-black/50 hover:text-[#c0442f] dark:text-white/45 dark:hover:text-[#ff8b77]"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isToday ? "bg-[#f05d49]" : "border border-current"
            }`}
          />
          Today
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            id="chrono-timeline-controls"
            key="controls"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3">
              <div className="relative h-11">
                <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/15 dark:bg-white/15" />
                <div
                  className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-[#f05d49] shadow-[0_0_10px_rgba(240,93,73,0.55)]"
                  style={{ width: `${progress}%` }}
                />

                {crashMarkers.markers.map((marker) => {
                  const left = Math.min(
                    99.5,
                    Math.max(
                      0.5,
                      (dateToValue(marker.date) / TOTAL_DAYS) * 100,
                    ),
                  );

                  return (
                    <button
                      key={marker.date}
                      type="button"
                      onClick={() => setFocusedDate(marker.date)}
                      style={{ left: `${left}%` }}
                      title={`${marker.name} · ${formatDate(marker.date)}`}
                      aria-label={`${marker.name}, ${formatDate(marker.date)}`}
                      className="group absolute top-1/2 z-20 grid h-11 w-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center"
                    >
                      <span
                        className={`block rounded-full transition-transform duration-200 group-hover:scale-150 ${
                          marker.major
                            ? "h-1.5 w-1.5 bg-[#f05d49]"
                            : "h-1 w-1 bg-black/35 dark:bg-white/35"
                        }`}
                      />
                    </button>
                  );
                })}

                <input
                  type="range"
                  min={0}
                  max={TOTAL_DAYS}
                  step={1}
                  value={value}
                  onChange={(event) =>
                    setFocusedDate(valueToDate(Number(event.target.value)))
                  }
                  onPointerDown={() => setScrubbing(true)}
                  onPointerUp={() => setScrubbing(false)}
                  onPointerCancel={() => setScrubbing(false)}
                  onBlur={() => setScrubbing(false)}
                  aria-label="Focused date"
                  aria-valuetext={formatDate(focusedDate)}
                  className="chrono-range absolute inset-0 z-10 h-11 w-full cursor-ew-resize appearance-none bg-transparent"
                />
              </div>

              <div className="mt-2 flex items-center gap-2.5">
                <span className="whitespace-nowrap text-micro font-medium uppercase tracking-[0.12em] text-black/45 dark:text-white/45">
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
                  aria-label={`Open precise UTC date and time picker. Current value ${formatDateTime(focusedDate, focusedTime)}`}
                  className="group flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-black/10 bg-black/[0.025] py-1 pl-3 pr-2 text-left text-meta tabular-nums tracking-[-0.01em] text-black/70 outline-none transition-colors hover:bg-black/[0.04] focus-visible:border-black/20 focus-visible:ring-1 focus-visible:ring-[#f05d49]/40 sm:h-9 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:hover:bg-white/[0.06]"
                >
                  <svg
                    viewBox="0 0 16 16"
                    className="h-3.5 w-3.5 shrink-0 text-[#f05d49]"
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
                  <span className="truncate">
                    {formatDateTime(focusedDate, focusedTime)}
                  </span>
                  <span className="ml-auto shrink-0 text-[7px] font-medium uppercase tracking-[0.16em] text-black/30 transition-colors group-hover:text-[#c0442f] dark:text-white/25 dark:group-hover:text-[#ff8b77]">
                    Edit
                  </span>
                </button>
              </div>

              <div className="mt-2.5 flex items-center justify-between gap-3 text-micro font-medium uppercase tracking-[0.1em] text-black/45 dark:text-white/40">
                <span>1906</span>
                <span
                  className={
                    status === "error"
                      ? "text-[#c0442f] dark:text-[#ff8b77]"
                      : ""
                  }
                >
                  {statusLabel}
                </span>
                <span>{TIMELINE_MAX.slice(0, 4)}</span>
              </div>

              <FutureLane
                matches={ladderMatches}
                status={ladderStatus}
                focusedDate={focusedDate}
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
