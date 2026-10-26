"use client";

import { motion } from "framer-motion";
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
      </div>
    </div>
  );
}
