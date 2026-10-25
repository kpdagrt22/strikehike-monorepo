"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getEnergyTone } from "@/lib/energyTone";
import { useChronoStore } from "@/store/chronoStore";

const SIZE = 116;
const CENTER = SIZE / 2;
const RADIUS = 49;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatYear(iso) {
  const year = new Date(`${iso}T00:00:00Z`).getUTCFullYear();
  return Number.isFinite(year) ? year : "";
}

function ParallelCarousel({ parallels, status }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (parallels.length <= 1) return undefined;

    const timer = setInterval(() => setTick((value) => value + 1), 4000);
    return () => clearInterval(timer);
  }, [parallels.length]);

  const parallel = parallels.length ? parallels[tick % parallels.length] : null;
  const parallelKey = parallel ? `${parallel.date}-${parallel.name}` : "empty";

  return (
    <div className="mt-3 h-4 w-full text-center">
      <AnimatePresence mode="wait" initial={false}>
        {parallel ? (
          <motion.p
            key={parallelKey}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="truncate text-[10px] font-medium tracking-[-0.01em] text-black/55 dark:text-white/55"
          >
            Similar Energy to: {formatYear(parallel.date)} {parallel.name}
          </motion.p>
        ) : (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="text-[10px] font-medium tracking-[-0.01em] text-black/35 dark:text-white/35"
          >
            {status === "loading"
              ? "Reading historical parallels…"
              : "Historical parallels unavailable"}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

export function EnergyGauge({ isDark = true }) {
  const energy = useChronoStore((state) => state.energy);
  const parallels = useChronoStore((state) => state.parallels);
  const status = useChronoStore((state) => state.status);

  const score =
    energy?.score != null && Number.isFinite(Number(energy.score))
      ? Math.max(0, Math.min(100, Number(energy.score)))
      : null;
  const tone = getEnergyTone(energy?.polarity, isDark);
  const offset =
    score === null ? CIRCUMFERENCE : CIRCUMFERENCE * (1 - score / 100);

  const label =
    energy?.polarity ??
    (status === "loading" ? "Reading sky" : "Awaiting data");

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-20 flex w-[min(23rem,calc(100vw-2rem))] -translate-x-1/2 select-none flex-col items-center sm:top-6">
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
              ? "Energy score pending"
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
              <feGaussianBlur stdDeviation="3.5" result="blur" />
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
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            style={{ filter: "url(#energy-glow)" }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[30px] font-light leading-none tabular-nums tracking-[-0.05em] text-[#14121a] drop-shadow-[0_1px_12px_rgba(255,255,255,0.35)] dark:text-[#f2ede4] dark:drop-shadow-[0_1px_14px_rgba(0,0,0,0.45)]">
            {score === null ? "—" : Math.round(score)}
          </span>
          <span className="mt-1 text-[8px] font-medium uppercase tracking-[0.26em] text-black/40 dark:text-white/40">
            Energy
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[8px] font-medium uppercase tracking-[0.24em] text-black/45 dark:text-white/45">
        <span
          className="h-1 w-1 rounded-full"
          style={{
            backgroundColor: tone.stroke,
            boxShadow: `0 0 10px ${tone.stroke}`,
          }}
        />
        {label}
      </div>

      <ParallelCarousel
        key={
          parallels.map((parallel) => `${parallel.date}-${parallel.name}`).join("|") ||
          "empty"
        }
        parallels={parallels}
        status={status}
      />
    </div>
  );
}
