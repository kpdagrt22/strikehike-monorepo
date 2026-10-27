"use client";

import { AnimatePresence, motion } from "framer-motion";
import { categoryTone } from "@/lib/categoryTone";
import { getEnergyTone } from "@/lib/energyTone";
import { bestParallel } from "@/lib/parallelEpoch";
import { useChronoStore } from "@/store/chronoStore";

const SIZE = 116;
const CENTER = SIZE / 2;
const RADIUS = 49;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatYear(iso) {
  const year = new Date(`${iso}T00:00:00Z`).getUTCFullYear();
  return Number.isFinite(year) ? year : "";
}

function SelectedDayParallel({ parallels }) {
  const parallel = bestParallel(parallels);
  if (!parallel) return null;

  const tone = categoryTone(parallel.category);

  return (
    <div className="mt-3 w-full text-center">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${parallel.date}-${parallel.name}-${parallel.similarity_percent}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="flex min-w-0 max-w-full flex-col items-center rounded-2xl px-3.5 py-1.5"
        >
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: tone.color }}
            />
            <span className="text-micro font-medium uppercase tracking-[0.1em] text-black/60 dark:text-white/60">
              Most Similar Day
            </span>
          </span>
          <span className="mt-0.5 flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-center text-meta font-medium leading-snug tracking-[-0.01em] text-black/70 dark:text-white/70">
            <span className="whitespace-normal">
              {formatYear(parallel.date)} {parallel.name}
            </span>
            {Number.isFinite(Number(parallel.similarity_percent)) ? (
              <span className="whitespace-nowrap font-mono text-micro font-normal tracking-[0.08em] text-black/60 dark:text-white/60">
                · {Number(parallel.similarity_percent).toFixed(1)}% Match
              </span>
            ) : null}
          </span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function EnergyGauge({ isDark = true }) {
  const energy = useChronoStore((state) => state.energy);
  const parallels = useChronoStore((state) => state.parallels);
  const status = useChronoStore((state) => state.status);
  const mobileSheet = useChronoStore((state) => state.mobileSheet);
  // A failed read for the focused moment must not show the previous sky's
  // energy as current.
  const unavailable = useChronoStore(
    (state) =>
      state.status === "error" &&
      state.positionsDateTime !== `${state.focusedDate}T${state.focusedTime}`,
  );

  const score =
    !unavailable &&
    energy?.score != null &&
    Number.isFinite(Number(energy.score))
      ? Math.max(0, Math.min(100, Number(energy.score)))
      : null;
  const tone = getEnergyTone(unavailable ? null : energy?.polarity, isDark);
  const offset =
    score === null ? CIRCUMFERENCE : CIRCUMFERENCE * (1 - score / 100);

  const label = unavailable
    ? "Unavailable"
    : (energy?.polarity ??
      (status === "loading" ? "Reading sky" : "Awaiting data"));

  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-[4.5rem] z-20 flex w-[min(21rem,calc(100vw-1.5rem))] -translate-x-1/2 select-none flex-col items-center transition-opacity duration-200 motion-reduce:transition-none sm:top-6 sm:w-[min(23rem,calc(100vw-2rem))] ${
        mobileSheet ? "max-lg:opacity-0" : ""
      }`}
    >
      <div className="relative h-[116px] w-[116px]">
        <div
          aria-hidden="true"
          className="absolute inset-3 rounded-full opacity-70 blur-2xl"
          style={{ backgroundColor: tone.glow }}
        />

        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="relative h-full w-full overflow-visible"
          role="img"
          aria-label={
            score === null
              ? unavailable
                ? "Energy score unavailable"
                : "Energy score pending"
              : `Energy score ${Math.round(score)} out of 100, ${label}`
          }
        >
          <defs>
            <filter
              id="energy-glow"
              x="-60%"
              y="-60%"
              width="220%"
              height="220%"
            >
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={isDark ? "rgba(255,255,255,0.12)" : "rgba(20,18,26,0.1)"}
            strokeWidth="1"
          />
          <motion.circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={tone.stroke}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            initial={{ strokeDashoffset: CIRCUMFERENCE }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            style={{ filter: "url(#energy-glow)" }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[32px] font-light leading-none tabular-nums tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4]">
            {score === null ? "—" : Math.round(score)}
          </span>
          <span className="mt-1 text-micro font-medium uppercase tracking-[0.18em] text-black/60 dark:text-white/60">
            Energy
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: tone.stroke }}
        />
        {label}
      </div>

      <SelectedDayParallel parallels={parallels} />
    </div>
  );
}
