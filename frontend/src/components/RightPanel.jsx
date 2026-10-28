"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDismissable } from "@/hooks/useDismissable";
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

function formatMoment(date, time) {
  const displayDate = new Date(`${date}T00:00:00Z`);
  const dateLabel = Number.isNaN(displayDate.getTime())
    ? date
    : dateFormatter.format(displayDate);
  return time && time !== "00:00" ? `${dateLabel} · ${time} UTC` : dateLabel;
}

const getDataDockButton = () =>
  document.getElementById("chrono-dock-alignment");

export function RightPanel() {
  const [open, setOpen] = useState(true);
  const [openRow, setOpenRow] = useState(null);
  const sheetRef = useRef(null);
  // Which control takes focus once the collapse/reopen swap has mounted it.
  const focusAfterSwap = useRef(null);
  const mobileSheet = useChronoStore((state) => state.mobileSheet);
  const setMobileSheet = useChronoStore((state) => state.setMobileSheet);
  const positions = useChronoStore((state) => state.positions);
  const positionsDateTime = useChronoStore((state) => state.positionsDateTime);
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const focusedTime = useChronoStore((state) => state.focusedTime);
  const status = useChronoStore((state) => state.status);
  const retryPositions = useChronoStore((state) => state.retryPositions);
  const mobileOpen = mobileSheet === "alignment";
  const panelOpen = mobileOpen || open;
  const dismissSheet = useDismissable(mobileOpen, {
    onClose: () => setMobileSheet(null),
    triggerRef: getDataDockButton,
    containerRef: sheetRef,
  });

  const closePanel = () => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      dismissSheet({ restoreFocus: true });
    } else {
      focusAfterSwap.current = "pill";
      setOpen(false);
    }
  };

  const reopenPanel = () => {
    focusAfterSwap.current = "collapse";
    setOpen(true);
  };

  // Retry unmounts with the error line: keep focus on the panel heading.
  const retrySky = () => {
    document
      .getElementById("chrono-alignment-title")
      ?.focus({ preventScroll: true });
    retryPositions();
  };

  const pillRef = useCallback((node) => {
    if (node && focusAfterSwap.current === "pill") {
      focusAfterSwap.current = null;
      node.focus({ preventScroll: true });
    }
  }, []);

  const collapseRef = useCallback((node) => {
    if (node && focusAfterSwap.current === "collapse") {
      focusAfterSwap.current = null;
      node.focus({ preventScroll: true });
    }
  }, []);

  const momentLabel = formatMoment(focusedDate, focusedTime);
  const skyError = status === "error";
  // The panel still holds an earlier moment's sky: say so and dim it.
  const stale =
    skyError &&
    Boolean(positions) &&
    positionsDateTime !== `${focusedDate}T${focusedTime}`;
  const staleLabel =
    stale && positionsDateTime
      ? formatMoment(...positionsDateTime.split("T"))
      : null;

  return (
    <div
      ref={sheetRef}
      className={`${
        mobileOpen
          ? "animate-sheet-up fixed inset-x-3 bottom-[8.5rem] z-50 block"
          : "hidden"
      } pointer-events-auto lg:fixed lg:right-5 lg:top-[6.75rem] lg:z-30 lg:block lg:max-h-none lg:overflow-visible`}
    >
      <AnimatePresence initial={false} mode="wait">
        {panelOpen ? (
          <motion.aside
            key="alignment-panel"
            initial={{ opacity: 0, x: 12 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
            }}
            exit={{
              opacity: 0,
              x: 10,
              transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
            }}
            id="chrono-alignment-sheet"
            aria-labelledby="chrono-alignment-title"
            className="w-full overflow-hidden rounded-2xl border border-black/10 bg-white/92 shadow-[0_18px_60px_rgba(20,18,26,0.14)] backdrop-blur-xl max-lg:flex max-lg:max-h-[70dvh] max-lg:flex-col lg:flex lg:max-h-[max(12.5rem,calc(100dvh-17.625rem))] lg:w-[min(20rem,calc(100vw-1.5rem))] lg:flex-col lg:bg-white/45 dark:border-white/10 dark:bg-[rgb(11_11_18/0.92)] dark:shadow-[0_18px_60px_rgba(0,0,0,0.5)] lg:dark:bg-black/25"
          >
            {/* The panel itself is height-capped (ending above the view
                pill); the list absorbs any extra header lines. */}
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-black/10 px-4 py-3.5 dark:border-white/10">
              <div className="min-w-0">
                <h2
                  id="chrono-alignment-title"
                  tabIndex={-1}
                  className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 focus:outline-none dark:text-white/60"
                >
                  Current alignment
                </h2>
                <p className="mt-1 text-meta tabular-nums text-black/65 dark:text-white/60">
                  {momentLabel}
                </p>
                <div role="status">
                  {skyError ? (
                    <p className="mt-1.5 text-meta leading-snug text-black/80 dark:text-white/80">
                      <span
                        className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#f05d49] align-middle"
                        aria-hidden="true"
                      />
                      {`Couldn't read the sky for ${momentLabel} · `}
                      <button
                        type="button"
                        onClick={retrySky}
                        className="-my-3 inline-block py-3 font-medium underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current lg:-my-1 lg:py-1"
                      >
                        Retry
                      </button>
                    </p>
                  ) : null}
                  {staleLabel ? (
                    <p className="mt-0.5 text-micro tabular-nums text-black/60 dark:text-white/60">
                      Showing {staleLabel}
                    </p>
                  ) : null}
                </div>
              </div>
              <button
                ref={collapseRef}
                type="button"
                onClick={closePanel}
                aria-label={
                  mobileOpen
                    ? "Close current alignment panel"
                    : "Collapse current alignment panel"
                }
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-black/10 text-black/60 transition-colors hover:bg-black/[0.04] focus-visible:bg-black/[0.04] lg:h-7 lg:w-7 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
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

            <div className="max-lg:min-h-0 max-lg:flex-1 overflow-y-auto overscroll-contain px-2 pt-2 pb-5 [mask-image:linear-gradient(to_bottom,#000_calc(100%_-_1.25rem),transparent)] [scrollbar-width:thin] lg:max-h-[max(8rem,calc(100dvh-22rem))] lg:min-h-0">
              {status === "loading" && !positions ? (
                <p className="px-2 py-4 text-meta text-black/60 dark:text-white/60">
                  Reading sky…
                </p>
              ) : null}

              {positions
                ? PLANET_ORDER.map((name) => {
                    const body = positions[name];
                    if (!body) return null;
                    const degree = Number(body.lon);
                    const retro = Boolean(body.retro);
                    const expanded = openRow === name;
                    const insightId = `chrono-alignment-insight-${name.toLowerCase()}`;

                    // The whole row is the disclosure: the name button's
                    // ::after stretches over it, so the row keeps its layout
                    // and gains one Tab stop that reveals the ML insight.
                    return (
                      <div
                        key={name}
                        className="group relative flex items-start gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-black/[0.04] has-[:focus-visible]:bg-black/[0.04] dark:hover:bg-white/[0.06] dark:has-[:focus-visible]:bg-white/[0.06]"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center text-[16px] leading-none text-black/70 dark:text-white/70"
                          style={{ fontFamily: "'Apple Symbols', 'Segoe UI Symbol', serif" }}
                        >
                          {SYMBOLS[name]}
                        </span>
                        <div
                          className={`min-w-0 flex-1 transition-opacity ${
                            stale ? "opacity-[0.38]" : ""
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="text-body font-medium tracking-[-0.01em] text-black/80 dark:text-white/80">
                              <button
                                type="button"
                                aria-expanded={expanded}
                                aria-controls={expanded ? insightId : undefined}
                                onClick={() =>
                                  setOpenRow((current) =>
                                    current === name ? null : name,
                                  )
                                }
                                className="text-left outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-(--sh-focus)"
                              >
                                {name}
                              </button>
                            </p>
                            <p className="text-meta tabular-nums text-black/60 dark:text-white/60">
                              {Number.isFinite(degree) ? `${degree.toFixed(2)}°` : "—"}
                            </p>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <p className="truncate text-micro tracking-[0.01em] text-black/60 dark:text-white/60">
                              {body.rashi} · {body.nakshatra}
                            </p>
                            <span
                              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-micro font-medium uppercase tracking-[0.06em] ${
                                retro
                                  ? "border-transparent text-[#c0442f] dark:text-[#ff8b77]"
                                  : "border-transparent text-black/60 dark:text-white/60"
                              }`}
                            >
                              {retro ? (
                                <>
                                  Retro
                                  <span className="sr-only">, retrograde</span>
                                </>
                              ) : (
                                "Direct"
                              )}
                            </span>
                          </div>
                          {expanded ? (
                            <p
                              id={insightId}
                              className="mt-1.5 text-meta leading-relaxed text-black/70 dark:text-white/70"
                            >
                              <span className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
                                ML index insight
                              </span>
                              {" · "}
                              {body.ml_insight ?? "—"}
                            </p>
                          ) : null}
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
            ref={pillRef}
            type="button"
            onClick={reopenPanel}
            initial={{ opacity: 0, x: 8 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
            }}
            exit={{
              opacity: 0,
              x: 8,
              transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
            }}
            aria-label="Open current alignment panel"
            className="flex min-h-11 items-center gap-2 rounded-full border border-black/10 bg-white/55 px-4 py-2 text-micro font-medium uppercase tracking-[0.14em] text-black/60 shadow-[0_14px_40px_rgba(20,18,26,0.12)] backdrop-blur-xl lg:min-h-0 dark:border-white/10 dark:bg-black/35 dark:text-white/60"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#f05d49]" />
            Alignment
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
