"use client";

import { motion } from "framer-motion";
import { getRegimeToneLabel } from "@/lib/regimeTone";
import { useChronoStore } from "@/store/chronoStore";

const VIEWS = [
  {
    id: "orbital",
    label: "Orbital view",
    icon: (
      <>
        <ellipse cx="12" cy="12" rx="8.5" ry="4.2" transform="rotate(-24 12 12)" />
        <circle cx="17.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="2.1" />
      </>
    ),
  },
  {
    id: "zenith",
    label: "Zenith view",
    icon: (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
        <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3" />
      </>
    ),
  },
];

export function ViewControls() {
  const cameraView = useChronoStore((state) => state.cameraView);
  const setCameraView = useChronoStore((state) => state.setCameraView);
  const regimeOverlay = useChronoStore((state) => state.regimeOverlay);
  const regimeTone = useChronoStore((state) => state.regimeTone);
  const regimeOverlayStatus = useChronoStore(
    (state) => state.regimeOverlayStatus,
  );
  const setRegimeOverlay = useChronoStore(
    (state) => state.setRegimeOverlay,
  );

  const dotClass = !regimeOverlay
    ? "bg-black/20 dark:bg-white/20"
    : regimeOverlayStatus === "loading"
      ? "bg-[#d8b47a] animate-pulse"
      : regimeTone === "favorable"
        ? "bg-[#0f766e] dark:bg-[#5eead4]"
        : regimeTone === "neutral"
          ? "bg-[#6b7280] dark:bg-[#9ca3af]"
          : regimeTone === "disruptive"
            ? "bg-[#c2410c] dark:bg-[#fb923c]"
            : "bg-black/20 dark:bg-white/20";

  const toneLabel = getRegimeToneLabel(regimeTone);
  const overlayTitle = !regimeOverlay
    ? "Regime overlay: tint orbit trails by the current macro regime"
    : regimeOverlayStatus === "loading"
      ? "Regime overlay: reading the macro archive"
      : regimeOverlayStatus === "unavailable"
        ? "Regime overlay: no full macro regime data for this date"
        : regimeOverlayStatus === "error"
          ? "Regime overlay: macro regime service unavailable"
          : toneLabel
            ? `Regime overlay: ${toneLabel}`
            : "Regime overlay";

  return (
    <div className="pointer-events-auto fixed bottom-24 right-5 z-30 hidden lg:block">
      <div className="flex items-center gap-1 rounded-full border border-black/10 bg-white/45 p-1 shadow-[0_16px_50px_rgba(20,18,26,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-black/30 dark:shadow-[0_16px_50px_rgba(0,0,0,0.45)]">
        {VIEWS.map((view) => {
          const active = cameraView === view.id;

          return (
            <motion.button
              key={view.id}
              type="button"
              onClick={() => setCameraView(view.id)}
              aria-label={view.label}
              aria-pressed={active}
              title={view.label}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.94 }}
              className={`grid h-11 w-11 place-items-center rounded-full border transition-colors duration-200 ${
                active
                  ? "border-black/10 bg-[#14121a] text-[#f2ede4] dark:border-white/15 dark:bg-[#f2ede4] dark:text-[#14121a]"
                  : "border-transparent text-black/45 hover:bg-black/[0.05] dark:text-white/45 dark:hover:bg-white/[0.07]"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                {view.icon}
              </svg>
            </motion.button>
          );
        })}

        <span
          className="mx-0.5 h-6 w-px bg-black/10 dark:bg-white/10"
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={() => setRegimeOverlay(!regimeOverlay)}
          aria-pressed={regimeOverlay}
          aria-label="Toggle regime overlay"
          title={overlayTitle}
          className={`flex h-11 items-center gap-2 rounded-full border border-transparent px-2.5 text-[10px] font-medium uppercase tracking-[0.12em] transition-colors duration-200 ${
            regimeOverlay
              ? "bg-black/[0.05] text-black/70 dark:bg-white/[0.08] dark:text-white/70"
              : "text-black/45 hover:bg-black/[0.05] dark:text-white/45 dark:hover:bg-white/[0.07]"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`}
            aria-hidden="true"
          />
          Regime
        </button>
      </div>
    </div>
  );
}
