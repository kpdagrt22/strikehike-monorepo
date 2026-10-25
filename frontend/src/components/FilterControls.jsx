"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CATEGORY_ORDER,
  categoryTone,
} from "@/lib/categoryTone";
import { useChronoStore } from "@/store/chronoStore";

export function FilterControls() {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState(false);
  const [activeCategory, setActiveCategory] = useState(null);
  const mobileSheet = useChronoStore((state) => state.mobileSheet);
  const setMobileSheet = useChronoStore((state) => state.setMobileSheet);
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const setFocusedDate = useChronoStore((state) => state.setFocusedDate);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRoster() {
      try {
        const response = await fetch("/api/events", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setRoster(await response.json());
      } catch (loadError) {
        if (loadError.name !== "AbortError") setError(true);
      }
    }

    loadRoster();
    return () => controller.abort();
  }, []);

  const categories = roster?.categories ?? {};
  const activeEvents =
    activeCategory && categories[activeCategory]
      ? categories[activeCategory]
      : [];

  const toggleCategory = (category) => {
    setActiveCategory((current) => (current === category ? null : category));
  };

  const travelToEvent = (eventDate) => {
    setFocusedDate(eventDate);
    setActiveCategory(null);
    setMobileSheet(null);
  };

  return (
    <div
      className={`${
        mobileSheet === "archive"
          ? "fixed inset-x-3 bottom-[4.25rem] z-50 block max-h-[70dvh] overflow-y-auto"
          : "hidden"
      } pointer-events-auto lg:fixed lg:left-5 lg:top-[6.75rem] lg:z-30 lg:block lg:max-h-none lg:overflow-visible`}
    >
      <div className="relative">
        <div className="rounded-[1.6rem] border border-black/10 bg-white/55 p-2 shadow-[0_18px_60px_rgba(20,18,26,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-black/55 dark:shadow-[0_18px_60px_rgba(0,0,0,0.5)] lg:bg-white/45 lg:dark:bg-black/25">
          <div className="flex items-start justify-between gap-2 px-2 pb-1.5 pt-1">
            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.24em] text-black/40 dark:text-white/35">
                Event archive
              </p>
              <p className="mt-0.5 text-[9px] tabular-nums text-black/30 dark:text-white/25">
                {roster?.total
                  ? `${roster.total} curated moments`
                  : "129 moments"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMobileSheet(null)}
              aria-label="Close event archive"
              className="grid h-7 w-7 place-items-center rounded-full border border-black/10 text-black/35 lg:hidden dark:border-white/10 dark:text-white/35"
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
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          <div className="space-y-1">
            {CATEGORY_ORDER.map((category) => {
              const isActive = activeCategory === category;
              const count = categories[category]?.length ?? 0;

              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  aria-expanded={isActive}
                  className={`flex w-full items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[10px] font-medium tracking-[-0.01em] transition-colors duration-200 ${
                    isActive
                      ? "border-black/10 bg-black/[0.07] text-[#14121a] dark:border-white/15 dark:bg-white/10 dark:text-[#f2ede4]"
                      : "border-transparent text-black/55 hover:bg-black/[0.035] dark:text-white/55 dark:hover:bg-white/[0.05]"
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: categoryTone(category).color,
                      boxShadow: `0 0 8px ${categoryTone(category).glow}`,
                    }}
                  />
                  <span className="truncate">{category}</span>
                  <span className="ml-auto text-[8px] tabular-nums text-black/25 dark:text-white/25">
                    {count || ""}
                  </span>
                </button>
              );
            })}
          </div>

          {error ? (
            <p className="px-2 pb-1 pt-1 text-[8px] leading-relaxed text-[#c0442f] dark:text-[#ff8b77]">
              Archive unavailable
            </p>
          ) : null}
        </div>

        <AnimatePresence>
          {activeCategory ? (
            <motion.div
              key={activeCategory}
              initial={{ opacity: 0, x: -8, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -6, scale: 0.985 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="absolute left-0 top-full mt-2 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-black/10 bg-white/80 shadow-[0_20px_70px_rgba(20,18,26,0.18)] backdrop-blur-2xl lg:left-full lg:top-0 lg:ml-2 lg:mt-0 dark:border-white/10 dark:bg-black/75 dark:shadow-[0_20px_70px_rgba(0,0,0,0.6)]"
              role="region"
              aria-label={`${activeCategory} events`}
            >
              <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
                <div>
                  <p className="text-[8px] font-medium uppercase tracking-[0.22em] text-black/40 dark:text-white/35">
                    {activeCategory}
                  </p>
                  <p className="mt-0.5 text-[10px] text-black/45 dark:text-white/45">
                    Select a date to travel
                  </p>
                </div>
                <span className="text-[9px] tabular-nums text-black/30 dark:text-white/25">
                  {activeEvents.length}
                </span>
              </div>

              <div className="max-h-[min(24rem,55vh)] overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin]">
                {activeEvents.map((event) => {
                  const isFocused = focusedDate === event.date;

                  return (
                    <button
                      key={`${event.date}-${event.name}`}
                      type="button"
                      onClick={() => travelToEvent(event.date)}
                      className={`group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                        isFocused
                          ? "bg-black/[0.06] dark:bg-white/[0.08]"
                          : "hover:bg-black/[0.035] dark:hover:bg-white/[0.045]"
                      }`}
                    >
                      <span
                        className="mt-1 h-1 w-1 shrink-0 rounded-full"
                        style={{
                          backgroundColor: categoryTone(activeCategory).color,
                          boxShadow: `0 0 8px ${categoryTone(activeCategory).glow}`,
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block text-[8px] font-medium tabular-nums uppercase tracking-[0.16em] text-black/35 dark:text-white/30">
                          {event.date}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-black/70 transition-colors group-hover:text-[#14121a] dark:text-white/65 dark:group-hover:text-white">
                          {event.name}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
