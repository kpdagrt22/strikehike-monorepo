"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import crashMarkers from "@/data/astro/crash_markers.json";
import {
  TIMELINE_MAX,
  TIMELINE_MIN,
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

function formatDate(iso) {
  return dateFormatter.format(new Date(`${iso}T00:00:00Z`));
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

export function Timeline() {
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const setFocusedDate = useChronoStore((state) => state.setFocusedDate);
  const setPositions = useChronoStore((state) => state.setPositions);
  const setStatus = useChronoStore((state) => state.setStatus);
  const status = useChronoStore((state) => state.status);
  const source = useChronoStore((state) => state.source);

  const [expanded, setExpanded] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");

      try {
        const response = await fetch(
          `/api/chrono/positions?date=${encodeURIComponent(focusedDate)}`,
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
  }, [focusedDate, setPositions, setStatus]);

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
    <motion.div
      layout
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => {
        if (!scrubbing) setExpanded(false);
      }}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
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
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={expanded}
        aria-controls={expanded ? "chrono-timeline-controls" : undefined}
        aria-label={`Focused date: ${formatDate(focusedDate)}. Open timeline.`}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full bg-[#f05d49] ${
            status === "loading" ? "animate-pulse" : ""
          }`}
        />

        {expanded ? (
          <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-black/45 dark:text-white/45">
            Focused date
          </span>
        ) : null}

        <span className="ml-auto whitespace-nowrap text-[12px] font-medium tabular-nums tracking-[-0.01em] text-[#14121a] dark:text-[#f2ede4]">
          {formatDate(focusedDate)}
        </span>
      </button>

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
              <div className="relative h-9">
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
                      className="group absolute top-1/2 z-20 grid h-5 w-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center"
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
                  className="chrono-range absolute inset-0 z-10 h-9 w-full cursor-ew-resize appearance-none bg-transparent"
                />
              </div>

              <div className="mt-0.5 flex items-center justify-between gap-3 text-[8px] font-medium uppercase tracking-[0.16em] text-black/35 dark:text-white/35">
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
                <span>2026</span>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
