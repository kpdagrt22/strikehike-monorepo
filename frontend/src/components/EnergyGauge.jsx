"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useSyncExternalStore } from "react";
import { categoryTone } from "@/lib/categoryTone";
import { getEnergyTone } from "@/lib/energyTone";
import { bestParallel } from "@/lib/parallelEpoch";
import { useChronoStore } from "@/store/chronoStore";
import { InfoTip } from "@/components/ui/InfoTip";
import { GaugeAura } from "@/components/GaugeAura";
import { FACE_RADIUS } from "@/lib/aura/crown";
import {
  GEOMETRY_MATCH_DEFINITION,
  SKY_ACTIVITY_DEFINITION,
} from "@/lib/astro/definitions";

const SIZE = 116;
const CENTER = SIZE / 2;
const RADIUS = 49;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatYear(iso) {
  const year = new Date(`${iso}T00:00:00Z`).getUTCFullYear();
  return Number.isFinite(year) ? year : "";
}

// Neutral words for the existing polarity thresholds: no new threshold and no
// good/bad label. "Disruptive" reads as high activity, "Favorable" as low.
function activityLevel(polarity) {
  const value = String(polarity ?? "").toLowerCase();
  if (
    value.includes("disruptive") ||
    value.includes("negative") ||
    value.includes("high")
  ) {
    return "High";
  }
  if (
    value.includes("favorable") ||
    value.includes("positive") ||
    value.includes("low")
  ) {
    return "Low";
  }
  return "Moderate";
}

function SelectedDayParallel({ parallels, compact = false }) {
  const parallel = bestParallel(parallels);
  if (!parallel) return null;

  const tone = categoryTone(parallel.category);

  return (
    <div
      data-hud-part="parallel"
      className={
        compact
          ? "w-full text-left"
          : "mt-3 w-full text-center pointer-coarse:mt-7"
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${parallel.date}-${parallel.name}-${parallel.similarity_percent}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className={
            compact
              ? "flex min-w-0 flex-col items-start"
              : "flex min-w-0 max-w-full flex-col items-center px-1 py-0.5"
          }
        >
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: tone.color }}
            />
            <span className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
              Closest past sky
            </span>
            <InfoTip
              label="What geometry match means"
              description={GEOMETRY_MATCH_DEFINITION}
            />
          </span>
          <span
            className={`mt-0.5 flex max-w-full flex-wrap gap-x-2 gap-y-0.5 text-meta font-medium leading-snug tracking-[-0.01em] text-black/70 dark:text-white/70 ${
              compact ? "items-start text-left" : "items-center justify-center text-center"
            }`}
          >
            <span className="whitespace-normal">
              {formatYear(parallel.date)} · {parallel.name}
            </span>
            {Number.isFinite(Number(parallel.similarity_percent)) ? (
              <span className="whitespace-nowrap font-mono text-micro font-normal tracking-[0.08em] text-black/60 dark:text-white/60">
                · geometry match{" "}
                {Number(parallel.similarity_percent).toFixed(1)}%
              </span>
            ) : null}
          </span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

const PHONE_QUERY = "(max-width: 639.98px)";
const SHORT_DESKTOP_QUERY = "(min-width: 640px) and (max-height: 820px)";

function subscribeQuery(query, onChange) {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

const getPhone = () => window.matchMedia(PHONE_QUERY).matches;
const getShortDesktop = () => window.matchMedia(SHORT_DESKTOP_QUERY).matches;
const getServerQuery = () => false;

export function EnergyGauge({
  isDark = true,
  homeIntro = false,
  gaugeTop = null,
}) {
  const phone = useSyncExternalStore(
    (onChange) => subscribeQuery(PHONE_QUERY, onChange),
    getPhone,
    getServerQuery,
  );
  const shortDesktop = useSyncExternalStore(
    (onChange) => subscribeQuery(SHORT_DESKTOP_QUERY, onChange),
    getShortDesktop,
    getServerQuery,
  );
  // Side by side where the top band is short (phones, and desktops under
  // 820 px tall); stacked when there is room above the orrery.
  const horizontal = phone || shortDesktop;
  const compact = phone;
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
    : energy?.polarity
      ? activityLevel(energy.polarity)
      : status === "loading"
        ? "Reading sky"
        : "Awaiting data";

  return (
    <div
      data-hud="gauge"
      style={gaugeTop != null ? { top: `${gaugeTop}px` } : undefined}
      className={`pointer-events-none absolute left-1/2 z-20 flex w-[min(21rem,calc(100vw-1.5rem))] -translate-x-1/2 select-none transition-opacity duration-200 motion-reduce:transition-none sm:w-[min(21rem,calc(100vw-2rem))] xl:w-[min(23rem,calc(100vw-2rem))] ${
        horizontal ? "flex-row items-center gap-3" : "flex-col items-center"
      } ${
        homeIntro
          ? "top-[17.5rem] sm:top-[27rem] lg:top-[8.5rem]"
          : "top-[4.5rem] sm:top-(--sh-header-clear)"
      } ${
        mobileSheet ? "max-lg:opacity-0" : ""
      }`}
    >
      {/* From 85 the ring gains an animated flame aura (GaugeAura.jsx). */}
      <div className="relative h-[116px] w-[116px]">
        <div
          aria-hidden="true"
          className="absolute inset-3 rounded-full opacity-70 blur-2xl"
          style={{ backgroundColor: tone.glow }}
        />
        <GaugeAura
          score={score}
          isDark={isDark}
          paused={Boolean(mobileSheet)}
          compact={compact}
        />
        {/* The score's face: opaque and above every aura layer, so nothing
            passes behind or over the digits. */}
        <div
          aria-hidden="true"
          data-gauge-face
          className="absolute rounded-full bg-(--sh-surface-face)"
          style={{
            inset: CENTER - FACE_RADIUS,
            boxShadow: "var(--sh-face-shadow)",
          }}
        />

        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="relative h-full w-full overflow-visible"
          role="img"
          aria-label={
            score === null
              ? unavailable
                ? "Sky activity unavailable"
                : "Sky activity pending"
              : `Sky activity ${Math.round(score)} out of 100, ${label}`
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

        {/* "/ 100" sits under the number at every size: side by side, "100"
            would not clear the face's edge. */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            data-gauge-score
            className="flex flex-col items-center tabular-nums"
          >
            <span
              data-gauge-number
              className="text-[30px] font-light leading-none tracking-[-0.05em] text-(--sh-ink) dark:text-(--sh-pearl)"
            >
              {score === null ? "—" : Math.round(score)}
            </span>
            <span
              data-gauge-of
              className="mt-0.5 font-mono text-meta leading-none tracking-[0.02em] text-(--sh-text-2)"
            >
              / 100
            </span>
          </span>
        </div>
      </div>

      <div
        data-gauge-captions
        className={
          horizontal
            ? "flex min-w-0 flex-1 flex-col items-start gap-1.5 text-left"
            : "mt-2.5 flex w-full flex-col items-center"
        }
      >
        <div className="flex items-center gap-2 text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: tone.stroke }}
          />
          {score === null ? label : `Sky activity · ${label}`}
          <InfoTip
            label="What sky activity means"
            description={SKY_ACTIVITY_DEFINITION}
          />
        </div>
        <SelectedDayParallel parallels={parallels} compact={compact} />
      </div>
    </div>
  );
}
