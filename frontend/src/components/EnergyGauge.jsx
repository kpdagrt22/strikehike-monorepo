"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { categoryTone } from "@/lib/categoryTone";
import { getEnergyTone } from "@/lib/energyTone";
import { splitParallels } from "@/lib/parallelEpoch";
import { useChronoStore } from "@/store/chronoStore";

const SIZE = 116;
const CENTER = SIZE / 2;
const RADIUS = 49;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatYear(iso) {
  const year = new Date(`${iso}T00:00:00Z`).getUTCFullYear();
  return Number.isFinite(year) ? year : "";
}

function EpochRow({ epoch, parallel }) {
  const recent = epoch === "recent";
  const tone = categoryTone(parallel.category);

  return (
    <div
      className={`flex min-w-0 max-w-full items-center justify-center gap-2 rounded-full px-3 py-1 ${
        recent
          ? "recent-glow border border-[#f05d49]/25 bg-white/30 dark:bg-white/[0.05]"
          : ""
      }`}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          backgroundColor: tone.color,
          boxShadow: `0 0 8px ${tone.glow}`,
        }}
      />
      <span
        className={`shrink-0 text-micro font-medium uppercase tracking-[0.1em] ${
          recent
            ? "text-[#c0442f] dark:text-[#ff8b77]"
            : "text-black/50 dark:text-white/45"
        }`}
      >
        {recent ? "Recent Manifestations" : "Historical Parallels"}
      </span>
      <span className="min-w-0 truncate text-meta font-medium tracking-[-0.01em] text-black/70 dark:text-white/70">
        {formatYear(parallel.date)} {parallel.name}
      </span>
    </div>
  );
}

function DualEpochCarousel({ parallels, status }) {
  const [tick, setTick] = useState(0);
  const { historical, recent } = splitParallels(parallels);
  const longest = Math.max(historical.length, recent.length);

  useEffect(() => {
    if (longest <= 1) return undefined;

    const timer = setInterval(() => setTick((value) => value + 1), 5000);
    return () => clearInterval(timer);
  }, [longest]);

  const historicalPick = historical.length
    ? historical[tick % historical.length]
    : null;
  const recentPick = recent.length ? recent[tick % recent.length] : null;
  const parallelKey = `${historicalPick?.date}-${historicalPick?.name}|${recentPick?.date}-${recentPick?.name}`;

  return (
    <div className="mt-3 w-full text-center">
      <AnimatePresence mode="wait" initial={false}>
        {historicalPick || recentPick ? (
          <motion.div
            key={parallelKey}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-full flex-col items-center gap-1.5"
          >
            {historicalPick ? (
              <EpochRow epoch="historical" parallel={historicalPick} />
            ) : null}
            {recentPick ? (
              <EpochRow epoch="recent" parallel={recentPick} />
            ) : null}
          </motion.div>
        ) : (
          <motion.p
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="text-meta font-medium tracking-[-0.01em] text-black/45 dark:text-white/45"
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
    <div className="pointer-events-none absolute left-1/2 top-3 z-20 flex w-[min(21rem,calc(100vw-1.5rem))] -translate-x-1/2 select-none flex-col items-center sm:top-6 sm:w-[min(23rem,calc(100vw-2rem))]">
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
          <span className="text-[32px] font-light leading-none tabular-nums tracking-[-0.05em] text-[#14121a] drop-shadow-[0_1px_12px_rgba(255,255,255,0.35)] dark:text-[#f2ede4] dark:drop-shadow-[0_1px_14px_rgba(0,0,0,0.45)]">
            {score === null ? "—" : Math.round(score)}
          </span>
          <span className="mt-1 text-micro font-medium uppercase tracking-[0.18em] text-black/50 dark:text-white/50">
            Energy
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-micro font-medium uppercase tracking-[0.14em] text-black/55 dark:text-white/55">
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: tone.stroke,
            boxShadow: `0 0 10px ${tone.stroke}`,
          }}
        />
        {label}
      </div>

      <DualEpochCarousel
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
