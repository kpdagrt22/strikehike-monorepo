"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useChronoStore } from "@/store/chronoStore";

const PLANET_ORDER = [
  "Sun",
  "Moon",
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
  Moon: "☽",
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
  const mobileSheet = useChronoStore((state) => state.mobileSheet);
  const setMobileSheet = useChronoStore((state) => state.setMobileSheet);
  const positions = useChronoStore((state) => state.positions);
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const focusedTime = useChronoStore((state) => state.focusedTime);
  const status = useChronoStore((state) => state.status);
  const mobileOpen = mobileSheet === "alignment";
  const panelOpen = mobileOpen || open;

  const closePanel = () => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      setMobileSheet(null);
    } else {
      setOpen(false);
    }
  };

  const displayDate = new Date(`${focusedDate}T00:00:00Z`);
  const dateLabel = Number.isNaN(displayDate.getTime())
    ? focusedDate
    : dateFormatter.format(displayDate);
  const timeLabel = focusedTime !== "00:00" ? ` · ${focusedTime} UTC` : "";

  return (
    <div
      className={`${
        mobileOpen
          ? "animate-sheet-up fixed inset-x-3 bottom-[8.5rem] z-50 block max-h-[70dvh] overflow-y-auto"
          : "hidden"
      } pointer-events-auto lg:fixed lg:right-5 lg:top-[6.75rem] lg:z-30 lg:block lg:max-h-none lg:overflow-visible`}
    >
      <AnimatePresence initial={false} mode="wait">
        {panelOpen ? (
          <motion.aside
            key="alignment-panel"
            initial={{ opacity: 0, x: 12, width: 0 }}
            animate={{ opacity: 1, x: 0, width: "auto" }}
            exit={{ opacity: 0, x: 10, width: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            id="chrono-alignment-sheet"
            className="w-full overflow-hidden rounded-2xl border border-black/10 bg-white/70 shadow-[0_18px_60px_rgba(20,18,26,0.14)] backdrop-blur-xl lg:w-[min(20rem,calc(100vw-1.5rem))] lg:bg-white/45 dark:border-white/10 dark:bg-black/70 dark:shadow-[0_18px_60px_rgba(0,0,0,0.5)] lg:dark:bg-black/25"
          >
            <div className="flex items-start justify-between gap-3 border-b border-black/10 px-4 py-3.5 dark:border-white/10">
              <div>
                <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/50 dark:text-white/50">
                  Current alignment
                </p>
                <p className="mt-1 text-meta tabular-nums text-black/65 dark:text-white/60">
                  {dateLabel}
                  {timeLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={closePanel}
                aria-label={
                  mobileOpen
                    ? "Close current alignment panel"
                    : "Collapse current alignment panel"
                }
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-black/10 text-black/50 transition-colors hover:bg-black/[0.04] lg:h-7 lg:w-7 dark:border-white/10 dark:text-white/50 dark:hover:bg-white/[0.06]"
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
                  {mobileOpen ? (
                    <path d="M4 4l8 8M12 4l-8 8" />
                  ) : (
                    <path d="M6 3.5 10.5 8 6 12.5" />
                  )}
                </svg>
              </button>
            </div>

            <div className="max-h-[calc(100dvh-13rem)] overflow-y-auto overscroll-contain px-2 py-2 [scrollbar-width:thin]">
              {status === "loading" && !positions ? (
                <p className="px-2 py-4 text-meta text-black/50 dark:text-white/50">
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
                          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-black/10 bg-black/[0.025] text-[16px] leading-none text-black/65 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/65"
                          style={{ fontFamily: "'Apple Symbols', 'Segoe UI Symbol', serif" }}
                        >
                          {SYMBOLS[name]}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-body font-medium tracking-[-0.01em] text-black/80 dark:text-white/80">
                              {name}
                            </p>
                            <p className="text-meta tabular-nums text-black/55 dark:text-white/55">
                              {Number.isFinite(degree) ? `${degree.toFixed(2)}°` : "—"}
                            </p>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <p className="truncate text-micro tracking-[0.01em] text-black/50 dark:text-white/45">
                              {body.rashi} · {body.nakshatra}
                            </p>
                            <span
                              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-micro font-medium uppercase tracking-[0.06em] ${
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
            className="flex min-h-11 items-center gap-2 rounded-full border border-black/10 bg-white/55 px-4 py-2 text-micro font-medium uppercase tracking-[0.14em] text-black/55 shadow-[0_14px_40px_rgba(20,18,26,0.12)] backdrop-blur-xl lg:min-h-0 dark:border-white/10 dark:bg-black/35 dark:text-white/50"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#f05d49]" />
            Alignment
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
