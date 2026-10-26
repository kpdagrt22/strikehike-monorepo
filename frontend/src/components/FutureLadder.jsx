"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { categoryTone } from "@/lib/categoryTone";
import { useChronoStore } from "@/store/chronoStore";

export function FutureLadder() {
  const [ladder, setLadder] = useState(null);
  const [error, setError] = useState(false);
  const mobileSheet = useChronoStore((state) => state.mobileSheet);
  const setMobileSheet = useChronoStore((state) => state.setMobileSheet);
  const setFocusedDate = useChronoStore((state) => state.setFocusedDate);

  useEffect(() => {
    const controller = new AbortController();

    async function loadLadder() {
      try {
        const response = await fetch("/api/forecast-ladder", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setLadder(await response.json());
      } catch (loadError) {
        if (loadError.name !== "AbortError") setError(true);
      }
    }

    loadLadder();
    return () => controller.abort();
  }, []);

  const matches = ladder?.matches ?? [];

  return (
    <div
      className={`${
        mobileSheet === "future"
          ? "animate-sheet-up fixed inset-x-3 bottom-[8.5rem] z-50 block max-h-[70dvh] overflow-y-auto"
          : "hidden"
      } pointer-events-auto lg:fixed lg:left-5 lg:top-[23.5rem] lg:z-30 lg:block lg:w-[min(18rem,calc(100vw-1.5rem))] lg:max-h-none lg:overflow-visible`}
    >
      <div
        id="chrono-ladder-sheet"
        className="overflow-hidden rounded-2xl border border-black/10 bg-white/70 shadow-[0_18px_60px_rgba(20,18,26,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-black/70 dark:shadow-[0_18px_60px_rgba(0,0,0,0.5)] lg:bg-white/35 lg:dark:bg-black/25"
      >
        <div className="flex items-start justify-between gap-2 border-b border-black/10 px-3.5 py-3 dark:border-white/10">
          <div>
            <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/50 dark:text-white/50">
              Future ladder
            </p>
            <p className="mt-1 text-meta text-black/45 dark:text-white/40">
              Next 180 days · 85%+ geometry
            </p>
          </div>
          <div className="flex items-center gap-1 lg:hidden">
            <button
              type="button"
              onClick={() => setMobileSheet("archive")}
              className="h-11 rounded-full border border-black/10 px-3 text-micro font-medium uppercase tracking-[0.1em] text-black/55 dark:border-white/10 dark:text-white/55"
            >
              Events
            </button>
            <button
              type="button"
              onClick={() => setMobileSheet(null)}
              aria-label="Close future ladder"
              className="grid h-11 w-11 place-items-center rounded-full border border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
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

        <div className="max-h-[min(24rem,55dvh)] overflow-y-auto p-1.5 [scrollbar-width:thin] lg:max-h-[min(16rem,40vh)]">
          {error ? (
            <p className="px-2 py-3 text-meta text-[#c0442f] dark:text-[#ff8b77]">
              Forecast unavailable
            </p>
          ) : null}

          {!error && !ladder ? (
            <p className="px-2 py-3 text-meta text-black/45 dark:text-white/40">
              Reading the next sky…
            </p>
          ) : null}

          {!error && ladder && matches.length === 0 ? (
            <p className="px-2 py-3 text-meta leading-relaxed text-black/45 dark:text-white/40">
              No 85%+ geometric echoes in this window.
            </p>
          ) : null}

          {matches.map((match) => {
            const tone = categoryTone(match.event.category);

            return (
              <motion.button
                key={`${match.date}-${match.event.name}`}
                type="button"
                onClick={() => {
                  setFocusedDate(match.date);
                  setMobileSheet(null);
                }}
                whileHover={{ x: 2 }}
                className="group flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-black/[0.035] dark:hover:bg-white/[0.045]"
              >
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: tone.color,
                    boxShadow: `0 0 9px ${tone.glow}`,
                  }}
                />
                <span className="min-w-0">
                  <span className="block text-micro font-medium uppercase tracking-[0.1em] text-black/45 dark:text-white/40">
                    In {match.days_ahead} days · {match.similarity_percent}%
                  </span>
                  <span className="mt-0.5 block text-body leading-snug text-black/75 group-hover:text-[#14121a] dark:text-white/70 dark:group-hover:text-white">
                    {match.event.name}
                  </span>
                  <span className="mt-0.5 block text-micro tabular-nums text-black/40 dark:text-white/35">
                    {match.date} · {match.event.category}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
