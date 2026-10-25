"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const STORAGE_KEY = "hasSeenIntro";

const GUIDE = [
  {
    label: "Hover over planets to reveal data",
    icon: (
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
    ),
  },
  {
    label: "Drag the timeline to travel through history",
    icon: <path d="M4 12h16M7 8l-4 4 4 4M17 8l4 4-4 4" />,
  },
  {
    label: "Rotate the cosmos to explore",
    icon: (
      <>
        <ellipse cx="12" cy="12" rx="9" ry="4.5" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
  },
];

export function OnboardingOverlay({ introComplete = false }) {
  const [hasSeenIntro, setHasSeenIntro] = useState(() => {
    try {
      return (
        typeof window !== "undefined" &&
        Boolean(localStorage.getItem(STORAGE_KEY))
      );
    } catch {
      return false;
    }
  });

  const visible = introComplete && !hasSeenIntro;

  const enter = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Storage can be unavailable in privacy modes; the overlay still closes.
    }
    setHasSeenIntro(true);
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md overflow-hidden rounded-[1.75rem] border border-white/20 bg-white/65 p-7 text-[#14121a] shadow-[0_30px_100px_rgba(20,18,26,0.22)] backdrop-blur-2xl dark:border-white/15 dark:bg-black/45 dark:text-[#f2ede4] dark:shadow-[0_30px_100px_rgba(0,0,0,0.6)]"
          >
            <p className="text-[9px] font-medium uppercase tracking-[0.3em] text-black/45 dark:text-white/40">
              StrikeHike · First Contact
            </p>
            <h2
              id="onboarding-title"
              className="mt-3 max-w-sm text-[26px] font-light leading-[1.1] tracking-[-0.04em] sm:text-[30px]"
            >
              Welcome to the Universal Chrono-Spatial Engine.
            </h2>

            <div className="mt-7 space-y-4">
              {GUIDE.map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-black/10 bg-black/[0.035] dark:border-white/15 dark:bg-white/[0.06]">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {item.icon}
                    </svg>
                  </span>
                  <p className="text-[12px] leading-relaxed text-black/65 dark:text-white/65">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>

            <button
              type="button"
              autoFocus
              onClick={enter}
              className="mt-8 w-full rounded-full border border-black/10 bg-[#14121a] px-5 py-3 text-[10px] font-medium uppercase tracking-[0.26em] text-white transition-colors hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f05d49]/60 dark:border-white/10 dark:bg-[#f2ede4] dark:text-[#14121a] dark:hover:bg-white"
            >
              Enter
            </button>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
