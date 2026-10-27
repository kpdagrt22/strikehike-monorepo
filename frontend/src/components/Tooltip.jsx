"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTheme } from "next-themes";
import { getEnergyTone } from "@/lib/energyTone";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useChronoStore } from "@/store/chronoStore";
import { useEntityStore } from "@/store/entityStore";

// Mouse hover reveals wait briefly for intent and close after a short grace;
// a tap or click pins the readout open at once.
const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 300;
const EASE_OUT = [0.22, 1, 0.36, 1];
const EASE_EXIT = [0.4, 0, 1, 1];

export function Tooltip() {
  const hoveredEntity = useEntityStore((state) => state.hoveredEntity);
  const pinnedEntity = useEntityStore((state) => state.pinnedEntity);
  const clearPinnedEntity = useEntityStore(
    (state) => state.clearPinnedEntity,
  );
  const energy = useChronoStore((state) => state.energy);
  const marketEnergy = useChronoStore((state) => state.marketEnergy);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const tone = getEnergyTone(energy?.polarity, isDark);
  const reducedMotion = usePrefersReducedMotion();
  const asideRef = useRef(null);
  const [hoverShown, setHoverShown] = useState(null);

  // Hover follows intent: open after a short dwell, close after a grace
  // period, and move between planets without a fresh delay.
  useEffect(() => {
    if (hoveredEntity === hoverShown) return undefined;
    const delay = hoveredEntity
      ? hoverShown
        ? 0
        : HOVER_OPEN_MS
      : HOVER_CLOSE_MS;
    const timer = setTimeout(() => setHoverShown(hoveredEntity), delay);
    return () => clearTimeout(timer);
  }, [hoveredEntity, hoverShown]);

  const pinned = Boolean(pinnedEntity);
  const entity = pinnedEntity ?? hoverShown;

  const closeReadout = useCallback(() => {
    const hadFocus = asideRef.current?.contains(document.activeElement);
    clearPinnedEntity();
    if (!hadFocus) return;
    // The readout is leaving: keep keyboard focus in the page, not on <body>.
    const heading = document.querySelector("main h1");
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }, [clearPinnedEntity]);

  // Esc closes a pinned readout.
  useEffect(() => {
    if (!pinned) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      closeReadout();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pinned, closeReadout]);

  const hidden = reducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 4, scale: 0.98 };

  return (
    <AnimatePresence>
      {entity ? (
        <motion.aside
          ref={asideRef}
          aria-label={`Planet readout: ${entity.name}`}
          initial={hidden}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
            transition: { duration: 0.2, ease: EASE_OUT },
          }}
          exit={{ ...hidden, transition: { duration: 0.14, ease: EASE_EXIT } }}
          className={`${
            pinned ? "pointer-events-auto" : "pointer-events-none"
          } absolute right-3 bottom-40 z-20 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-black/10 bg-white/80 p-4 font-sans text-[#14121a] shadow-[0_24px_80px_rgb(20_18_26/0.18)] backdrop-blur-md backdrop-saturate-150 lg:bottom-auto lg:right-[22rem] lg:top-[15.5rem] dark:border-white/15 dark:bg-[rgb(11_11_18/0.8)] dark:text-[#f2ede4] dark:shadow-[0_24px_80px_rgb(0_0_0/0.55)]`}
        >
          {pinned ? (
            <button
              type="button"
              onClick={closeReadout}
              aria-label="Close planet readout"
              className="absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center rounded-full text-black/60 transition-[background-color,color,transform] duration-[140ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-black/[0.04] hover:text-black/85 focus-visible:bg-black/[0.04] focus-visible:text-black/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(192_68_47/0.7)] active:scale-[0.97] dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white/90 dark:focus-visible:bg-white/[0.06] dark:focus-visible:text-white/90 dark:focus-visible:outline-[rgb(255_139_119/0.75)]"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 12 12"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
              >
                <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
              </svg>
            </button>
          ) : null}

          <div className={`flex items-center gap-3 ${pinned ? "pr-11" : ""}`}>
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
                <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
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
              <p className="text-micro font-medium uppercase tracking-[0.1em] text-black/60 dark:text-white/60">
                Rashi
              </p>
              <p className="mt-0.5 text-body text-black/75 dark:text-white/75">
                {entity.rashi ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-micro font-medium uppercase tracking-[0.1em] text-black/60 dark:text-white/60">
                Nakshatra · Pada
              </p>
              <p className="mt-0.5 truncate text-body text-black/75 dark:text-white/75">
                {entity.nakshatra ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-micro font-medium uppercase tracking-[0.1em] text-black/60 dark:text-white/60">
                Longitude
              </p>
              <p className="mt-0.5 text-body tabular-nums text-black/75 dark:text-white/75">
                {Number.isFinite(Number(entity.degree))
                  ? `${Number(entity.degree).toFixed(2)}°`
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-micro font-medium uppercase tracking-[0.1em] text-black/60 dark:text-white/60">
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

          {entity.ml_insight ? (
            <div className="mt-3 border-t border-black/10 pt-3 dark:border-white/10">
              <p className="text-micro font-medium uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
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
                <span className="text-micro font-medium uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
                  Date energy
                </span>
                <span className="flex items-center gap-1.5 text-meta font-medium tabular-nums text-black/70 dark:text-white/70">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: tone.stroke }}
                  />
                  {Math.round(energy.score)} · {energy.polarity}
                </span>
              </div>
              <p className="mt-1.5 text-meta leading-relaxed text-black/60 dark:text-white/60">
                {energy.description}
              </p>

              {marketEnergy ? (
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-black/5 pt-2 dark:border-white/5">
                  <span className="min-w-0 text-micro font-medium uppercase leading-snug tracking-[0.06em] text-black/60 dark:text-white/60">
                    Financial Market Volatility
                  </span>
                  <span className="shrink-0 text-meta font-medium tabular-nums text-black/60 dark:text-white/60">
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
