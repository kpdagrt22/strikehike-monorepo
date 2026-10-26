"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useChronoStore } from "@/store/chronoStore";

export function SponsorModule() {
  const [open, setOpen] = useState(false);
  const timeControlsExpanded = useChronoStore(
    (state) => state.timeControlsExpanded,
  );

  return (
    <div
      className={`pointer-events-auto fixed bottom-32 right-6 z-30 flex flex-col items-end gap-3 lg:bottom-6 lg:right-6 ${
        timeControlsExpanded ? "max-lg:hidden" : ""
      }`}
    >
      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            id="strikehike-sponsor-panel"
            role="region"
            aria-label="Support StrikeHike"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.985 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="max-h-[calc(100dvh-10rem)] w-[min(20rem,calc(100vw-2.5rem))] overflow-y-auto rounded-2xl border border-black/10 bg-white/80 p-4 text-[#14121a] shadow-[0_24px_80px_rgba(20,18,26,0.2)] backdrop-blur-xl dark:border-white/10 dark:bg-black/40 dark:text-[#f2ede4] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[8px] font-medium uppercase tracking-[0.22em] text-black/40 dark:text-white/35">
                  Support
                </p>
                <p className="mt-1 text-[12px] text-black/55 dark:text-white/50">
                  Keep the engine independent.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close support panel"
                className="grid h-7 w-7 place-items-center rounded-full border border-black/10 text-black/35 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-white/35 dark:hover:bg-white/[0.06]"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>

            <div className="mt-3 flex justify-center rounded-xl border border-black/10 bg-white p-2 dark:border-white/10">
              <img
                src="/support-qr-cropped.webp"
                alt="Kotak UPI QR code to support StrikeHike"
                className="w-[min(13.5rem,100%)] rounded-lg object-contain"
              />
            </div>

            <p className="mt-3 text-center text-[12px] font-medium tracking-[-0.01em] text-black/60 dark:text-white/60">
              Scan to Support
            </p>

            <div className="mt-3 border-t border-black/10 pt-3 text-center dark:border-white/10">
              <p className="text-[13px] font-medium tracking-[0.01em] text-black/75 dark:text-white/75">
                KANTUMUTCHU PRAKASH
              </p>
              <p className="mt-1 break-all font-mono text-[12px] tracking-[0.02em] text-black/45 dark:text-white/45">
                9330980131@kotakbank
              </p>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label="Open sponsorship and support"
          aria-expanded={open}
          aria-controls="strikehike-sponsor-panel"
          className="grid h-11 w-11 place-items-center rounded-full border border-[#f05d49]/25 bg-white/45 text-[#c0442f] shadow-[0_0_24px_rgba(240,93,73,0.22)] backdrop-blur-xl transition-colors hover:border-[#f05d49]/50 hover:bg-white/60 dark:border-[#ff8b77]/25 dark:bg-black/30 dark:text-[#ff8b77] dark:hover:border-[#ff8b77]/50 dark:hover:bg-black/40"
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
            <path d="m12 3 2.1 6.1L20 11l-5.9 1.9L12 19l-2.1-6.1L4 11l5.9-1.9z" />
            <path d="M18 17.5v3M16.5 19h3" />
          </svg>
        </button>
      </motion.div>
    </div>
  );
}
