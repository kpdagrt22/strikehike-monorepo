"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { categoryTone } from "@/lib/categoryTone";
import { useChronoStore } from "@/store/chronoStore";

export function FutureLadder() {
  const [ladder, setLadder] = useState(null);
  const [error, setError] = useState(false);
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
    <div className="pointer-events-auto fixed left-3 top-[23.5rem] z-30 w-[min(16.5rem,calc(100vw-1.5rem))] sm:left-5">
      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white/35 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-black/25 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
        <div className="border-b border-black/10 px-3.5 py-3 dark:border-white/10">
          <p className="text-[8px] font-medium uppercase tracking-[0.24em] text-black/40 dark:text-white/35">
            Future ladder
          </p>
          <p className="mt-1 text-[9px] text-black/35 dark:text-white/30">
            Next 180 days · 85%+ geometry
          </p>
        </div>

        <div className="max-h-[min(16rem,40vh)] overflow-y-auto p-1.5 [scrollbar-width:thin]">
          {error ? (
            <p className="px-2 py-3 text-[9px] text-[#c0442f] dark:text-[#ff8b77]">
              Forecast unavailable
            </p>
          ) : null}

          {!error && !ladder ? (
            <p className="px-2 py-3 text-[9px] text-black/35 dark:text-white/30">
              Reading the next sky…
            </p>
          ) : null}

          {!error && ladder && matches.length === 0 ? (
            <p className="px-2 py-3 text-[9px] leading-relaxed text-black/35 dark:text-white/30">
              No 85%+ geometric echoes in this window.
            </p>
          ) : null}

          {matches.map((match) => {
            const tone = categoryTone(match.event.category);

            return (
              <motion.button
                key={`${match.date}-${match.event.name}`}
                type="button"
                onClick={() => setFocusedDate(match.date)}
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
                  <span className="block text-[8px] font-medium uppercase tracking-[0.16em] text-black/35 dark:text-white/30">
                    In {match.days_ahead} days · {match.similarity_percent}%
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] leading-snug text-black/65 group-hover:text-[#14121a] dark:text-white/60 dark:group-hover:text-white">
                    {match.event.name}
                  </span>
                  <span className="mt-0.5 block text-[8px] tabular-nums text-black/25 dark:text-white/25">
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
