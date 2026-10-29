"use client";

import { motion } from "framer-motion";
import { RegimeOverlayButton } from "@/components/ViewControls";
import { useChronoStore } from "@/store/chronoStore";

const SELECTED =
  "bg-black/[0.07] text-[#14121a] dark:bg-white/[0.08] dark:text-[#f2ede4]";

const PANEL_BUTTONS = [
  {
    id: "archive",
    label: "Events",
    controls: "chrono-events-sheet chrono-ladder-sheet",
    icon: (
      <>
        <path d="M4 7.5h16M6.5 12h11M9 16.5h6" />
      </>
    ),
  },
  {
    id: "alignment",
    label: "Data",
    controls: "chrono-alignment-sheet",
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M8 8.5h8M8 12h8M8 15.5h5" />
      </>
    ),
  },
];

const VIEW_BUTTONS = [
  {
    id: "orbital",
    label: "Orbital view",
    icon: (
      <>
        <ellipse cx="12" cy="12" rx="8" ry="4" transform="rotate(-24 12 12)" />
        <circle cx="12" cy="12" r="1.8" />
      </>
    ),
  },
  {
    id: "zenith",
    label: "Zenith view",
    icon: (
      <>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      </>
    ),
  },
];

export function MobileDock() {
  const mobileSheet = useChronoStore((state) => state.mobileSheet);
  const setMobileSheet = useChronoStore((state) => state.setMobileSheet);
  const timeControlsExpanded = useChronoStore(
    (state) => state.timeControlsExpanded,
  );
  const cameraView = useChronoStore((state) => state.cameraView);
  const setCameraView = useChronoStore((state) => state.setCameraView);

  if (timeControlsExpanded) return null;

  const isPanelActive = (id) =>
    id === "archive"
      ? mobileSheet === "archive" || mobileSheet === "future"
      : mobileSheet === id;

  return (
    <div className="pointer-events-auto fixed bottom-[4.5rem] left-1/2 z-40 -translate-x-1/2 lg:hidden">
      <div className="flex items-center gap-1 rounded-full border border-black/10 bg-white/60 p-1 shadow-[0_16px_50px_rgba(20,18,26,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-black/55 dark:shadow-[0_16px_50px_rgba(0,0,0,0.55)]">
        {PANEL_BUTTONS.map((button) => {
          const active = isPanelActive(button.id);

          return (
            <motion.button
              key={button.id}
              id={`chrono-dock-${button.id}`}
              type="button"
              onClick={() =>
                setMobileSheet(active ? null : button.id)
              }
              aria-label={`${button.label} panel`}
              aria-controls={button.controls}
              aria-expanded={active}
              aria-pressed={active}
              title={`${button.label} panel`}
              whileTap={{ scale: 0.97 }}
              // Below 340px the labels go to screen readers only and the
              // buttons become 44px icons, so the whole dock fits.
              className={`relative flex h-11 items-center gap-1.5 rounded-full px-3 text-meta font-medium transition-colors duration-[140ms] max-[339px]:w-11 max-[339px]:justify-center max-[339px]:px-0 ${
                active
                  ? SELECTED
                  : "text-black/65 hover:bg-black/[0.04] focus-visible:bg-black/[0.04] dark:text-white/65 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.35"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {button.icon}
              </svg>
              <span className="max-[339px]:sr-only">{button.label}</span>
              {active ? (
                <span
                  className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current"
                  aria-hidden="true"
                />
              ) : null}
            </motion.button>
          );
        })}

        <span className="mx-0.5 h-6 w-px bg-black/10 dark:bg-white/10" />

        {VIEW_BUTTONS.map((button) => {
          const active = cameraView === button.id;

          return (
            <motion.button
              key={button.id}
              type="button"
              onClick={() => setCameraView(button.id)}
              aria-label={button.label}
              aria-pressed={active}
              title={button.label}
              whileTap={{ scale: 0.97 }}
              className={`relative grid h-11 w-11 place-items-center rounded-full transition-colors duration-[140ms] ${
                active
                  ? SELECTED
                  : "text-black/60 hover:bg-black/[0.04] focus-visible:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.25"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {button.icon}
              </svg>
              {active ? (
                <span
                  className="absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current"
                  aria-hidden="true"
                />
              ) : null}
            </motion.button>
          );
        })}

        <span className="mx-0.5 h-6 w-px bg-black/10 dark:bg-white/10" />

        <RegimeOverlayButton compact />
      </div>
    </div>
  );
}
