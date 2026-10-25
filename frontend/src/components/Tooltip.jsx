"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "next-themes";
import { categoryTone } from "@/lib/categoryTone";
import { getEnergyTone } from "@/lib/energyTone";
import { useChronoStore } from "@/store/chronoStore";
import { useEntityStore } from "@/store/entityStore";

export function Tooltip() {
  const entity = useEntityStore((state) => state.hoveredEntity);
  const energy = useChronoStore((state) => state.energy);
  const marketEnergy = useChronoStore((state) => state.marketEnergy);
  const parallels = useChronoStore((state) => state.parallels);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const tone = getEnergyTone(energy?.polarity, isDark);
  const closestEcho = parallels?.[0] ?? null;
  const category = categoryTone(closestEcho?.category);

  return (
    <AnimatePresence>
      {entity ? (
        <motion.aside
          role="status"
          aria-live="polite"
          aria-atomic="true"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none absolute right-3 bottom-32 z-20 w-[min(19rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-black/10 bg-black/5 p-4 font-sans text-[#14121a] shadow-[0_10px_40px_rgba(0,0,0,0.12)] backdrop-blur-md backdrop-saturate-150 lg:bottom-auto lg:right-[21.5rem] lg:top-5 dark:border-white/15 dark:bg-white/10 dark:text-[#f2ede4] dark:shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
          style={{ borderTopColor: category.color }}
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-black/10 bg-white/20 text-[19px] leading-none dark:border-white/15 dark:bg-white/5"
              style={{
                color: entity.color,
                fontFamily:
                  "'Apple Symbols', 'Segoe UI Symbol', 'Noto Sans Symbols 2', serif",
              }}
            >
              {entity.symbol}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[9px] font-medium uppercase tracking-[0.24em] text-black/45 dark:text-white/45">
                  Planet
                </p>
                <p className="text-[13px] font-medium tabular-nums tracking-[-0.01em]">
                  {entity.degree.toFixed(2)}°
                </p>
              </div>
              <h2 className="mt-0.5 truncate text-[15px] font-semibold tracking-[-0.02em]">
                {entity.name}
              </h2>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-black/10 pt-3 dark:border-white/10">
            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.18em] text-black/35 dark:text-white/35">
                Rashi
              </p>
              <p className="mt-0.5 text-[11px] text-black/70 dark:text-white/70">
                {entity.rashi ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.18em] text-black/35 dark:text-white/35">
                Nakshatra · Pada
              </p>
              <p className="mt-0.5 truncate text-[11px] text-black/70 dark:text-white/70">
                {entity.nakshatra ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.18em] text-black/35 dark:text-white/35">
                Longitude
              </p>
              <p className="mt-0.5 text-[11px] tabular-nums text-black/70 dark:text-white/70">
                {Number.isFinite(Number(entity.degree))
                  ? `${Number(entity.degree).toFixed(2)}°`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-[8px] font-medium uppercase tracking-[0.18em] text-black/35 dark:text-white/35">
                Motion
              </p>
              <p
                className={`mt-0.5 text-[11px] ${
                  entity.retrograde
                    ? "text-[#c0442f] dark:text-[#ff8b77]"
                    : "text-black/70 dark:text-white/70"
                }`}
              >
                {entity.retrograde ? "Retrograde" : "Direct"}
              </p>
            </div>
          </div>

          {closestEcho ? (
            <div className="mt-3 flex items-center gap-2 border-t border-black/10 pt-3 dark:border-white/10">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  backgroundColor: category.color,
                  boxShadow: `0 0 9px ${category.glow}`,
                }}
              />
              <span
                className="text-[8px] font-medium uppercase tracking-[0.16em]"
                style={{ color: category.color }}
              >
                {closestEcho.category}
              </span>
              <span className="truncate text-[9px] text-black/40 dark:text-white/35">
                {closestEcho.name}
              </span>
            </div>
          ) : null}

          {entity.ml_insight ? (
            <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
              <p className="text-[9px] font-medium uppercase tracking-[0.2em] text-black/40 dark:text-white/40">
                ML index insight
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-black/70 dark:text-white/70">
                {entity.ml_insight}
              </p>
            </div>
          ) : null}

          {energy ? (
            <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[8px] font-medium uppercase tracking-[0.2em] text-black/40 dark:text-white/40">
                  Date energy
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-medium tabular-nums text-black/65 dark:text-white/65">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor: tone.stroke,
                      boxShadow: `0 0 10px ${tone.stroke}`,
                    }}
                  />
                  {Math.round(energy.score)} · {energy.polarity}
                </span>
              </div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-black/45 dark:text-white/45">
                {energy.description}
              </p>

              {marketEnergy ? (
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-black/5 pt-2 dark:border-white/5">
                  <span className="text-[8px] font-medium uppercase tracking-[0.18em] text-black/35 dark:text-white/35">
                    Financial Market Volatility
                  </span>
                  <span className="text-[9px] font-medium tabular-nums text-black/45 dark:text-white/45">
                    {Math.round(marketEnergy.score)} - {marketEnergy.polarity}
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
