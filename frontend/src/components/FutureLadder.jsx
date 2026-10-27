"use client";

import { useEffect, useRef, useState } from "react";
import { categoryTone } from "@/lib/categoryTone";
import { useDismissable } from "@/hooks/useDismissable";
import { useChronoStore } from "@/store/chronoStore";

const getEventsDockButton = () =>
  document.getElementById("chrono-dock-archive");

export function FutureLadder() {
  const [reloadKey, setReloadKey] = useState(0);
  const sheetRef = useRef(null);
  const mobileSheet = useChronoStore((state) => state.mobileSheet);
  const setMobileSheet = useChronoStore((state) => state.setMobileSheet);
  const activeEventCategory = useChronoStore(
    (state) => state.activeEventCategory,
  );
  const setFocusedDate = useChronoStore((state) => state.setFocusedDate);
  const ladderMatches = useChronoStore((state) => state.ladderMatches);
  const ladderStatus = useChronoStore((state) => state.ladderStatus);
  const setLadder = useChronoStore((state) => state.setLadder);
  const sheetOpen = mobileSheet === "future";
  const dismissSheet = useDismissable(sheetOpen, {
    onClose: () => setMobileSheet(null),
    triggerRef: getEventsDockButton,
    containerRef: sheetRef,
  });

  const showArchive = () => {
    setMobileSheet("archive");
    // Focus follows the swap to the archive sheet's matching control.
    requestAnimationFrame(() =>
      document.getElementById("chrono-archive-to-ladder")?.focus(),
    );
  };

  useEffect(() => {
    const controller = new AbortController();

    async function loadLadder() {
      setLadder({ status: "loading", matches: [] });

      try {
        const response = await fetch("/api/forecast-ladder", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        setLadder({
          status: "ready",
          matches: payload.matches ?? [],
        });
      } catch (loadError) {
        if (loadError.name !== "AbortError") {
          setLadder({ status: "error", matches: [] });
        }
      }
    }

    loadLadder();
    return () => controller.abort();
  }, [setLadder, reloadKey]);

  const matches = ladderMatches;
  const error = ladderStatus === "error";
  const loading = ladderStatus === "idle" || ladderStatus === "loading";

  return (
    <div
      ref={sheetRef}
      className={`${
        mobileSheet === "future"
          ? "animate-sheet-up fixed inset-x-3 bottom-[8.5rem] z-50 block max-h-[70dvh] overflow-y-auto"
          : "hidden"
      } pointer-events-auto lg:fixed lg:left-5 lg:top-[23.5rem] lg:z-30 ${
        activeEventCategory ? "lg:hidden" : "lg:block"
      } lg:w-[min(18rem,calc(100vw-1.5rem))] lg:max-h-none lg:overflow-visible`}
    >
      <div
        id="chrono-ladder-sheet"
        className="overflow-hidden rounded-2xl border border-black/10 bg-white/92 shadow-[0_18px_60px_rgba(20,18,26,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-[rgb(11_11_18/0.92)] dark:shadow-[0_18px_60px_rgba(0,0,0,0.5)] lg:bg-white/35 lg:dark:bg-black/25"
      >
        <div className="flex items-start justify-between gap-2 border-b border-black/10 px-3.5 py-3 dark:border-white/10">
          <div>
            <h2
              id="chrono-ladder-title"
              className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60"
            >
              Future ladder
            </h2>
            <p className="mt-1 text-meta text-black/60 dark:text-white/60">
              Next 180 days · top match per category
            </p>
          </div>
          <div className="flex items-center gap-1 lg:hidden">
            <button
              id="chrono-ladder-to-archive"
              type="button"
              onClick={showArchive}
              className="h-11 rounded-full border border-black/10 px-3 text-micro font-medium uppercase tracking-[0.1em] text-black/60 dark:border-white/10 dark:text-white/60"
            >
              Events
            </button>
            <button
              type="button"
              onClick={() => dismissSheet({ restoreFocus: true })}
              aria-label="Close future ladder"
              className="grid h-11 w-11 place-items-center rounded-full border border-black/10 text-black/60 dark:border-white/10 dark:text-white/60"
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
        </div>

        <div className="max-h-[min(24rem,55dvh)] overflow-y-auto p-1.5 [scrollbar-width:thin] lg:max-h-[max(6rem,min(26rem,calc(100dvh-33.25rem)))]">
          {error ? (
            <p className="px-2 py-3 text-meta text-black/80 dark:text-white/80">
              <span
                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#f05d49] align-middle"
                aria-hidden="true"
              />
              {"Forecast unavailable · "}
              <button
                type="button"
                onClick={() => setReloadKey((key) => key + 1)}
                className="-my-3 inline-block py-3 font-medium underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current lg:-my-1 lg:py-1"
              >
                Retry
              </button>
            </p>
          ) : null}

          {!error && loading ? (
            <p className="px-2 py-3 text-meta text-black/60 dark:text-white/60">
              Reading the next sky…
            </p>
          ) : null}

          {!error && !loading && matches.length === 0 ? (
            <p className="px-2 py-3 text-meta leading-relaxed text-black/60 dark:text-white/60">
              No 75%+ geometric echoes in this window.
            </p>
          ) : null}

          {matches.map((match) => {
            const tone = categoryTone(match.event.category);

            return (
              <button
                key={`${match.date}-${match.event.name}`}
                type="button"
                onClick={() => {
                  setFocusedDate(match.date);
                  if (sheetOpen) dismissSheet({ restoreFocus: true });
                }}
                className="group flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors duration-[140ms] hover:bg-black/[0.04] focus-visible:bg-black/[0.04] dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
              >
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tone.color }}
                />
                <span className="min-w-0">
                  <span className="block text-micro font-medium uppercase tracking-[0.1em] text-black/60 dark:text-white/60">
                    In {match.days_ahead} days · {match.similarity_percent}%
                  </span>
                  <span className="mt-0.5 block text-body leading-snug text-black/75 group-hover:text-[#14121a] dark:text-white/70 dark:group-hover:text-white">
                    {match.event.name}
                  </span>
                  <span className="mt-0.5 block text-micro tabular-nums text-black/60 dark:text-white/60">
                    {match.date} · {match.event.category}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
