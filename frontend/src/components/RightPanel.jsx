"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useChronoStore } from "@/store/chronoStore";

const PLANET_ORDER = [
  "Sun",
  "Mercury",
  "Venus",
  "Mars",
  "Jupiter",
  "Saturn",
  "Rahu",
  "Ketu",
];

const SYMBOLS = {
  Sun: "☉",
  Mercury: "☿",
  Venus: "♀",
  Mars: "♂",
  Jupiter: "♃",
  Saturn: "♄",
  Rahu: "☊",
  Ketu: "☋",
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function RightPanel() {
  const [open, setOpen] = useState(true);
  const positions = useChronoStore((state) => state.positions);
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const focusedTime = useChronoStore((state) => state.focusedTime);
  const status = useChronoStore((state) => state.status);

  const displayDate = new Date(`${focusedDate}T00:00:00Z`);
  const dateLabel = Number.isNaN(displayDate.getTime())
    ? focusedDate
    : dateFormatter.format(displayDate);
  const timeLabel = focusedTime !== "00:00" ? ` · ${focusedTime} UTC` : "";

  return (
    <div className="pointer-events-auto fixed right-3 top-[6.75rem] z-30 sm:right-5">
      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.aside
            key="alignment-panel"
            initial={{ opacity: 0, x: 12, width: 0 }}
            animate={{ opacity: 1, x: 0, width: "auto" }}
            exit={{ opacity: 0, x: 10, width: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="w-[min(19rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-black/10 bg-white/45 shadow-[0_18px_60px_rgba(20,18,26,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-black/25 dark:shadow-[0_18px_60px_rgba(0,0,0,0.5)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-black/10 px-4 py-3.5 dark:border-white/10">
              <div>
                <p className="text-[8px] font-medium uppercase tracking-[0.24em] text-black/40 dark:text-white/35">
                  Current alignment
                </p>
                <p className="mt-1 text-[10px] tabular-nums text-black/55 dark:text-white/50">
                  {dateLabel}
                  {timeLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Collapse current alignment panel"
                className="grid h-7 w-7 place-items-center rounded-full border border-black/10 text-black/40 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-white/40 dark:hover:bg-white/[0.06]"
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

            <div className="max-h-[calc(100dvh-13rem)] overflow-y-auto overscroll-contain px-2 py-2 [scrollbar-width:thin]">
              {status === "loading" && !positions ? (
                <p className="px-2 py-4 text-[10px] text-black/40 dark:text-white/40">
                  Reading sky…
                </p>
              ) : null}

              {positions
                ? PLANET_ORDER.map((name) => {
                    const body = positions[name];
                    if (!body) return null;
                    const degree = Number(body.lon);
                    const retro = Boolean(body.retro);

                    return (
                      <div
                        key={name}
                        className="group flex items-start gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.045]"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-black/10 bg-black/[0.025] text-[13px] leading-none text-black/55 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/55"
                          style={{ fontFamily: "'Apple Symbols', 'Segoe UI Symbol', serif" }}
                        >
                          {SYMBOLS[name]}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-[10px] font-medium tracking-[-0.01em] text-black/75 dark:text-white/75">
                              {name}
                            </p>
                            <p className="text-[9px] tabular-nums text-black/45 dark:text-white/45">
                              {Number.isFinite(degree) ? `${degree.toFixed(2)}°` : "—"}
                            </p>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <p className="truncate text-[8px] tracking-[0.01em] text-black/40 dark:text-white/35">
                              {body.rashi} · {body.nakshatra}
                            </p>
                            <span
                              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[7px] font-medium uppercase tracking-[0.12em] ${
                                retro
                                  ? "border-[#f05d49]/25 text-[#c0442f] dark:border-[#ff8b77]/25 dark:text-[#ff8b77]"
                                  : "border-black/10 text-black/35 dark:border-white/10 dark:text-white/35"
                              }`}
                            >
                              {retro ? "Retro" : "Direct"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                : null}
            </div>
          </motion.aside>
        ) : (
          <motion.button
            key="alignment-collapsed"
            type="button"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            aria-label="Open current alignment panel"
            className="flex items-center gap-2 rounded-full border border-black/10 bg-white/45 px-3 py-2 text-[8px] font-medium uppercase tracking-[0.2em] text-black/45 shadow-[0_14px_40px_rgba(20,18,26,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-black/25 dark:text-white/40"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#f05d49]" />
            Alignment
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
