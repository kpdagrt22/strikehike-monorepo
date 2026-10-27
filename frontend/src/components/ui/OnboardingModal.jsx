"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const STORAGE_KEY = "strikehike:onboarding:v1";

const STEPS = [
  {
    number: "1",
    title: "The Timeline",
    body: "Scrub the chart to explore 120 years of history. Red zones are major crashes.",
    accent: "#67e8f9",
  },
  {
    number: "2",
    title: "The Score",
    body: "Our StrikeHike Core Index runs from -50 (Extreme Danger) to +50 (Strong Growth). Watch it predict the drops.",
    accent: "#facc15",
  },
  {
    number: "3",
    title: "The Future",
    body: "By studying historical cycles, we can anticipate what happens next.",
    accent: "#8b5cf6",
  },
];

export function OnboardingModal() {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (window.localStorage.getItem(STORAGE_KEY) !== "1") setOpen(true);
      } catch {
        // Private browsing can block storage; the modal still works in-memory.
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("strikehike:show-onboarding", show);
    return () =>
      window.removeEventListener("strikehike:show-onboarding", show);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event) => {
      if (event.key === "Escape") {
        try {
          window.localStorage.setItem(STORAGE_KEY, "1");
        } catch {
          // Ignore storage failures.
        }
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const close = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Ignore storage failures.
    }
    setOpen(false);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-[#050508]/55 p-4 backdrop-blur-md"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="onboarding-title"
            className="relative w-full max-w-[620px] overflow-hidden rounded-[2rem] border border-white/15 bg-white/75 p-6 shadow-[0_32px_120px_rgba(0,0,0,0.4)] backdrop-blur-3xl dark:border-white/10 dark:bg-[#0b0b12]/85 dark:shadow-[0_32px_120px_rgba(0,0,0,0.75)] sm:p-9"
            initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.4, ease: [0.22, 1, 0.36, 1] }
            }
          >
            <div
              className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-[#67e8f9]/20 blur-3xl"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -right-20 -bottom-24 h-64 w-64 rounded-full bg-[#8b5cf6]/20 blur-3xl"
              aria-hidden="true"
            />

            <div className="relative">
              <p className="text-micro font-medium uppercase tracking-[0.2em] text-[#c0442f] dark:text-[#ff8b77]">
                A note before you explore
              </p>
              <h2
                id="onboarding-title"
                className="mt-2 text-3xl font-semibold tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-4xl"
              >
                Read the market in three steps.
              </h2>
              <p className="mt-2 max-w-lg text-meta leading-relaxed text-black/55 dark:text-white/55">
                No jargon. Just history, a simple score, and a longer view of
                the cycles that keep returning.
              </p>

              <div className="mt-6 space-y-2.5">
                {STEPS.map((step) => (
                  <div
                    key={step.number}
                    className="flex gap-3 rounded-2xl border border-black/5 bg-white/55 p-3.5 dark:border-white/10 dark:bg-white/[0.045] sm:gap-4 sm:p-4"
                  >
                    <span
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{
                        backgroundColor: step.accent,
                        boxShadow: `0 0 14px ${step.accent}88`,
                      }}
                      aria-hidden="true"
                    />
                    <div>
                      <h3 className="text-meta font-semibold tracking-[-0.02em] text-[#14121a] dark:text-[#f2ede4]">
                        {step.number}. {step.title}:
                      </h3>
                      <p className="mt-0.5 text-micro leading-relaxed text-black/55 dark:text-white/55 sm:text-meta">
                        {step.body}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-col gap-3 border-t border-black/5 pt-4 dark:border-white/10 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-[280px] text-[10px] leading-relaxed text-black/35 dark:text-white/35">
                  Descriptive history, not investment advice. You can reopen
                  this note from the footer later.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#14121a] px-5 py-2.5 text-micro font-semibold text-[#f2ede4] transition-colors hover:bg-[#f05d49] dark:bg-[#f2ede4] dark:text-[#14121a] dark:hover:bg-[#ff8b77]"
                >
                  Explore the engine
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
