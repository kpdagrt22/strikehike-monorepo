"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { currentUtcDate } from "@/store/chronoStore";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
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

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseIso(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month: month - 1, day };
}

function monthOf(iso) {
  const { year, month } = parseIso(iso);
  return { year, month };
}

function monthLabel(year, month) {
  return `${MONTHS[month]} ${year}`;
}

function TimeField({ label, value, max, onChange, ariaLabel }) {
  const clamp = (next) => Math.max(0, Math.min(max, next));

  return (
    <div className="rounded-xl border border-black/10 bg-black/[0.025] px-2 py-2 dark:border-white/10 dark:bg-white/[0.04]">
      <p className="text-[7px] font-medium uppercase tracking-[0.18em] text-black/35 dark:text-white/30">
        {label}
      </p>
      <div className="mt-1 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          aria-label={`Decrease ${ariaLabel}`}
          className="grid h-6 w-6 place-items-center rounded-full border border-black/10 text-[12px] text-black/45 transition-colors hover:bg-black/[0.05] dark:border-white/10 dark:text-white/45 dark:hover:bg-white/[0.06]"
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={pad(value)}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(-2);
            onChange(digits ? clamp(Number(digits)) : 0);
          }}
          onFocus={(event) => event.target.select()}
          aria-label={ariaLabel}
          className="w-8 appearance-none bg-transparent text-center text-[18px] font-light tabular-nums tracking-[-0.04em] text-black/75 outline-none dark:text-white/75"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          aria-label={`Increase ${ariaLabel}`}
          className="grid h-6 w-6 place-items-center rounded-full border border-black/10 text-[12px] text-black/45 transition-colors hover:bg-black/[0.05] dark:border-white/10 dark:text-white/45 dark:hover:bg-white/[0.06]"
        >
          +
        </button>
      </div>
    </div>
  );
}

function PickerDialog({
  initialDate,
  initialTime,
  minDate,
  maxDate,
  onApply,
  onClose,
}) {
  const [draftDate, setDraftDate] = useState(initialDate);
  const [draftHour, setDraftHour] = useState(
    Number(initialTime.split(":")[0] || 0),
  );
  const [draftMinute, setDraftMinute] = useState(
    Number(initialTime.split(":")[1] || 0),
  );
  const [view, setView] = useState(() => monthOf(initialDate));
  const panelRef = useRef(null);

  const today = currentUtcDate();
  const dateParts = parseIso(draftDate);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const days = useMemo(() => {
    const firstWeekday = new Date(
      Date.UTC(view.year, view.month, 1),
    ).getUTCDay();
    const start = new Date(
      Date.UTC(view.year, view.month, 1 - firstWeekday),
    );

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start.getTime() + index * DAY_MS);
      const iso = date.toISOString().slice(0, 10);
      return {
        iso,
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === view.month,
        disabled: iso < minDate || iso > maxDate,
      };
    });
  }, [maxDate, minDate, view]);

  const moveMonth = (delta) => {
    const next = new Date(Date.UTC(view.year, view.month + delta, 1));
    setView({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };

  const selectDay = (iso, inMonth) => {
    setDraftDate(iso);
    if (!inMonth) setView(monthOf(iso));
  };

  const apply = () => {
    onApply(draftDate, `${pad(draftHour)}:${pad(draftMinute)}`);
  };

  const now = new Date();
  const nowTime = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        type="button"
        aria-label="Close date and time picker"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />

      <motion.section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="date-picker-title"
        tabIndex={-1}
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.985 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-[min(24rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-[1.5rem] border border-black/10 bg-white/95 p-4 text-[#14121a] shadow-[0_30px_100px_rgba(20,18,26,0.28)] backdrop-blur-2xl outline-none dark:border-white/15 dark:bg-[#11101a]/95 dark:text-[#f2ede4] dark:shadow-[0_30px_100px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[8px] font-medium uppercase tracking-[0.24em] text-black/40 dark:text-white/35">
              Precise UTC
            </p>
            <h2
              id="date-picker-title"
              className="mt-1 text-[17px] font-medium tracking-[-0.03em]"
            >
              {monthLabel(view.year, view.month)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close date and time picker"
            className="grid h-8 w-8 place-items-center rounded-full border border-black/10 text-black/35 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-white/35 dark:hover:bg-white/[0.06]"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => moveMonth(-1)}
            aria-label="Previous month"
            className="grid h-8 w-8 place-items-center rounded-full border border-black/10 text-black/40 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-white/40 dark:hover:bg-white/[0.06]"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M10 3.5 5.5 8 10 12.5" />
            </svg>
          </button>
          <span className="text-[9px] font-medium uppercase tracking-[0.16em] text-black/35 dark:text-white/30">
            {dateParts.month === view.month &&
            dateParts.year === view.year
              ? "Selected month"
              : "Navigate month"}
          </span>
          <button
            type="button"
            onClick={() => moveMonth(1)}
            aria-label="Next month"
            className="grid h-8 w-8 place-items-center rounded-full border border-black/10 text-black/40 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-white/40 dark:hover:bg-white/[0.06]"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 3.5 10.5 8 6 12.5" />
            </svg>
          </button>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-0.5 text-center">
          {WEEKDAYS.map((weekday) => (
            <span
              key={weekday}
              className="py-1 text-[8px] font-medium uppercase tracking-[0.08em] text-black/35 dark:text-white/30"
            >
              {weekday}
            </span>
          ))}

          {days.map((day) => {
            const selected = day.iso === draftDate;
            const isToday = day.iso === today;

            return (
              <button
                key={day.iso}
                type="button"
                disabled={day.disabled}
                onClick={() => selectDay(day.iso, day.inMonth)}
                aria-label={day.iso}
                aria-pressed={selected}
                className={`relative mx-auto grid h-8 w-8 place-items-center rounded-full text-[10px] tabular-nums transition-colors ${
                  selected
                    ? "bg-[#f05d49] font-medium text-white shadow-[0_0_16px_rgba(240,93,73,0.35)]"
                    : day.disabled
                      ? "cursor-not-allowed text-black/15 dark:text-white/10"
                      : day.inMonth
                        ? "text-black/65 hover:bg-black/[0.05] dark:text-white/65 dark:hover:bg-white/[0.07]"
                        : "text-black/25 hover:bg-black/[0.03] dark:text-white/20 dark:hover:bg-white/[0.04]"
                } ${isToday && !selected ? "ring-1 ring-[#f05d49]/55" : ""}`}
              >
                {day.day}
                {isToday ? (
                  <span
                    className={`absolute bottom-1 h-0.5 w-0.5 rounded-full ${
                      selected ? "bg-white" : "bg-[#f05d49]"
                    }`}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[8px] font-medium uppercase tracking-[0.2em] text-black/35 dark:text-white/30">
              Time · UTC
            </p>
            <div className="flex items-center gap-1">
              {["00:00", "06:00", "12:00", "18:00"].map((time) => {
                const active =
                  draftHour === Number(time.slice(0, 2)) &&
                  draftMinute === Number(time.slice(3, 5));

                return (
                  <button
                    key={time}
                    type="button"
                    onClick={() => {
                      setDraftHour(Number(time.slice(0, 2)));
                      setDraftMinute(Number(time.slice(3, 5)));
                    }}
                    className={`rounded-full border px-2 py-1 text-[8px] tabular-nums transition-colors ${
                      active
                        ? "border-[#f05d49]/40 text-[#c0442f] dark:text-[#ff8b77]"
                        : "border-black/10 text-black/35 hover:bg-black/[0.04] dark:border-white/10 dark:text-white/35 dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    {time}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <TimeField
              label="Hour"
              value={draftHour}
              max={23}
              onChange={setDraftHour}
              ariaLabel="hour"
            />
            <TimeField
              label="Minute"
              value={draftMinute}
              max={59}
              onChange={setDraftMinute}
              ariaLabel="minute"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5 border-t border-black/10 pt-3 dark:border-white/10">
          <button
            type="button"
            onClick={() => onApply(today, "00:00")}
            className="rounded-full border border-black/10 px-2.5 py-1.5 text-[8px] font-medium uppercase tracking-[0.12em] text-black/45 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-white/40 dark:hover:bg-white/[0.06]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onApply(today, nowTime)}
            className="rounded-full border border-black/10 px-2.5 py-1.5 text-[8px] font-medium uppercase tracking-[0.12em] text-black/45 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-white/40 dark:hover:bg-white/[0.06]"
          >
            Now
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-[9px] font-medium text-black/45 transition-colors hover:bg-black/[0.04] dark:text-white/40 dark:hover:bg-white/[0.06]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="rounded-full bg-[#f05d49] px-4 py-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-white shadow-[0_0_20px_rgba(240,93,73,0.25)] transition-colors hover:bg-[#e8533f]"
          >
            Apply
          </button>
        </div>
      </motion.section>
    </motion.div>
  );
}

export function DateTimePicker({
  open,
  initialDate,
  initialTime,
  minDate,
  maxDate,
  onApply,
  onClose,
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <PickerDialog
          key={`${initialDate}-${initialTime}`}
          initialDate={initialDate}
          initialTime={initialTime}
          minDate={minDate}
          maxDate={maxDate}
          onApply={onApply}
          onClose={onClose}
        />
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
