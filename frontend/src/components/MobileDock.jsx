"use client";

import { motion } from "framer-motion";
import { useChronoStore } from "@/store/chronoStore";

const SHEET_BUTTONS = [
  {
    id: "archive",
    label: "Event archive",
    icon: (
      <>
        <path d="M4 7.5h16M6.5 12h11M9 16.5h6" />
      </>
    ),
  },
  {
    id: "future",
    label: "Future ladder",
    icon: (
      <>
        <path d="M4 16.5 9 11l3.5 3.5L20 6.5" />
        <path d="M14.5 6.5H20v5.5" />
      </>
    ),
  },
  {
    id: "alignment",
    label: "Current alignment",
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

  return (
    <div className="pointer-events-auto fixed bottom-[4.25rem] left-1/2 z-40 -translate-x-1/2 lg:hidden">
      <div className="flex items-center gap-0.5 rounded-full border border-black/10 bg-white/55 p-1 shadow-[0_16px_50px_rgba(20,18,26,0.16)] backdrop-blur-xl dark:border-white/10 dark:bg-black/45 dark:shadow-[0_16px_50px_rgba(0,0,0,0.55)]">
        {SHEET_BUTTONS.map((button) => {
          const active = mobileSheet === button.id;
          return (
            <motion.button
              key={button.id}
              type="button"
              onClick={() => setMobileSheet(active ? null : button.id)}
              aria-label={button.label}
              aria-pressed={active}
              title={button.label}
              whileTap={{ scale: 0.9 }}
              className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
                active
                  ? "bg-[#14121a] text-[#f2ede4] dark:bg-[#f2ede4] dark:text-[#14121a]"
                  : "text-black/45 hover:bg-black/[0.05] dark:text-white/45 dark:hover:bg-white/[0.07]"
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
            </motion.button>
          );
        })}

        <span className="mx-0.5 h-5 w-px bg-black/10 dark:bg-white/10" />

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
              whileTap={{ scale: 0.9 }}
              className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
                active
                  ? "text-[#f05d49]"
                  : "text-black/35 hover:bg-black/[0.05] dark:text-white/35 dark:hover:bg-white/[0.07]"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                {button.icon}
              </svg>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
