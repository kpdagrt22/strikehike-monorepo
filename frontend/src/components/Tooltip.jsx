"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "next-themes";
import { categoryTone } from "@/lib/categoryTone";
import { getEnergyTone } from "@/lib/energyTone";
import { bestParallel } from "@/lib/parallelEpoch";
import { useChronoStore } from "@/store/chronoStore";
import { useEntityStore } from "@/store/entityStore";

function SimilarDaySection({ parallel }) {
  if (!parallel) return null;

  const tone = categoryTone(parallel.category);

  return (
    <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
      <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/50 dark:text-white/45">
        Most Similar Day
      </p>

      <div className="mt-2 flex items-start gap-2">
        <span
          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            backgroundColor: tone.color,
            boxShadow: `0 0 8px ${tone.glow}`,
          }}
        />
        <div className="min-w-0 flex-1">
          <p className="whitespace-normal text-meta font-medium leading-snug text-black/75 dark:text-white/75">
            {parallel.name}
          </p>
          <p
            className="text-micro tabular-nums"
            style={{ color: tone.color }}
          >
            {parallel.category} · {parallel.date.slice(0, 4)} ·{" "}
            {Math.round(parallel.similarity_percent)}%
          </p>
        </div>
      </div>
    </div>
  );
}

export function Tooltip() {
  const entity = useEntityStore((state) => state.hoveredEntity);
  const energy = useChronoStore((state) => state.energy);
  const marketEnergy = useChronoStore((state) => state.marketEnergy);
  const parallels = useChronoStore((state) => state.parallels);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const tone = getEnergyTone(energy?.polarity, isDark);
  const parallel = bestParallel(parallels);

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
          className="pointer-events-none absolute right-3 bottom-40 z-20 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-black/10 bg-black/5 p-4 font-sans text-[#14121a] shadow-[0_10px_40px_rgba(0,0,0,0.12)] backdrop-blur-md backdrop-saturate-150 lg:bottom-auto lg:right-[22rem] lg:top-5 dark:border-white/15 dark:bg-white/10 dark:text-[#f2ede4] dark:shadow-[0_10px_40px_rgba(0,0,0,0.4)]"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-black/10 bg-white/20 text-[21px] leading-none dark:border-white/15 dark:bg-white/5"
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
                <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/50 dark:text-white/50">
                  Planet
                </p>
                <p className="text-strong font-medium tabular-nums tracking-[-0.01em]">
                  {entity.degree.toFixed(2)}°
                </p>
              </div>
              <h2 className="mt-0.5 truncate text-[16px] font-semibold tracking-[-0.02em]">
                {entity.name}
              </h2>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-black/10 pt-3 dark:border-white/10">
            <div>
              <p className="text-micro font-medium uppercase tracking-[0.1em] text-black/45 dark:text-white/40">
                Rashi
              </p>
              <p className="mt-0.5 text-body text-black/75 dark:text-white/75">
                {entity.rashi ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-micro font-medium uppercase tracking-[0.1em] text-black/45 dark:text-white/40">
                Nakshatra · Pada
              </p>
              <p className="mt-0.5 truncate text-body text-black/75 dark:text-white/75">
                {entity.nakshatra ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-micro font-medium uppercase tracking-[0.1em] text-black/45 dark:text-white/40">
                Longitude
              </p>
              <p className="mt-0.5 text-body tabular-nums text-black/75 dark:text-white/75">
                {Number.isFinite(Number(entity.degree))
                  ? `${Number(entity.degree).toFixed(2)}°`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-micro font-medium uppercase tracking-[0.1em] text-black/45 dark:text-white/40">
                Motion
              </p>
              <p
                className={`mt-0.5 text-body ${
                  entity.retrograde
                    ? "text-[#c0442f] dark:text-[#ff8b77]"
                    : "text-black/70 dark:text-white/70"
                }`}
              >
                {entity.retrograde ? "Retrograde" : "Direct"}
              </p>
            </div>
          </div>

          <SimilarDaySection parallel={parallel} />

          {entity.ml_insight ? (
            <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
              <p className="text-micro font-medium uppercase tracking-[0.12em] text-black/50 dark:text-white/45">
                ML index insight
              </p>
              <p className="mt-1 text-body leading-relaxed text-black/75 dark:text-white/75">
                {entity.ml_insight}
              </p>
            </div>
          ) : null}

          {energy ? (
            <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
              <div className="flex items-center justify-between gap-3">
                <span className="text-micro font-medium uppercase tracking-[0.12em] text-black/50 dark:text-white/45">
                  Date energy
                </span>
                <span className="flex items-center gap-1.5 text-meta font-medium tabular-nums text-black/70 dark:text-white/70">
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
              <p className="mt-1.5 text-meta leading-relaxed text-black/55 dark:text-white/55">
                {energy.description}
              </p>

              {marketEnergy ? (
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-black/5 pt-2 dark:border-white/5">
                  <span className="min-w-0 text-micro font-medium uppercase leading-snug tracking-[0.06em] text-black/45 dark:text-white/40">
                    Financial Market Volatility
                  </span>
                  <span className="shrink-0 text-meta font-medium tabular-nums text-black/55 dark:text-white/50">
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
