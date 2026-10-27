"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDismissable } from "@/hooks/useDismissable";
import { useChronoStore } from "@/store/chronoStore";
import { useEntityStore } from "@/store/entityStore";

export function SponsorModule() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const timeControlsExpanded = useChronoStore(
    (state) => state.timeControlsExpanded,
  );
  const mobileSheet = useChronoStore((state) => state.mobileSheet);
  // A pinned planet readout sits where the floating buttons are on phones.
  const readoutPinned = useEntityStore((state) => Boolean(state.pinnedEntity));
  const dismiss = useDismissable(open, {
    onClose: () => setOpen(false),
    triggerRef,
    containerRef: panelRef,
    closeOnOutside: true,
  });

  return (
    <div
      className={`pointer-events-auto fixed bottom-32 right-6 z-30 flex flex-col-reverse items-end gap-3 lg:bottom-6 lg:right-6 ${
        timeControlsExpanded || mobileSheet || readoutPinned
          ? "max-lg:hidden"
          : ""
      }`}
    >
      {/* Trigger first in the DOM; flex-col-reverse keeps the panel above it.
          A still heart at rest; hover or keyboard focus reveals the rupee. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open sponsorship and support"
        aria-expanded={open}
        aria-controls="strikehike-sponsor-panel"
        className="group grid h-11 w-11 place-items-center rounded-full border border-[#f05d49]/25 bg-white/45 text-[#c0442f] shadow-[0_12px_38px_rgba(20,18,26,0.15)] backdrop-blur-xl transition-[color,background-color,border-color,scale] duration-[140ms] hover:border-[#f05d49]/50 hover:bg-white/60 focus-visible:border-[#f05d49]/50 focus-visible:bg-white/60 active:scale-[0.97] dark:border-[#ff8b77]/25 dark:bg-black/30 dark:text-[#ff8b77] dark:hover:border-[#ff8b77]/50 dark:hover:bg-black/40 dark:focus-visible:border-[#ff8b77]/50 dark:focus-visible:bg-black/40"
      >
        <svg
          viewBox="0 0 24 24"
          className="col-start-1 row-start-1 h-4 w-4 transition-opacity duration-[140ms] group-hover:opacity-0 group-focus-visible:opacity-0 motion-reduce:transition-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z" />
        </svg>
        <span
          className="col-start-1 row-start-1 text-[17px] font-medium leading-none opacity-0 transition-opacity duration-[140ms] group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
          aria-hidden="true"
        >
          ₹
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            ref={panelRef}
            id="strikehike-sponsor-panel"
            role="region"
            aria-label="Support StrikeHike"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
            }}
            exit={{
              opacity: 0,
              y: 2,
              scale: 0.99,
              transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
            }}
            className="max-h-[calc(100dvh-10rem)] w-[min(20rem,calc(100vw-2.5rem))] overflow-y-auto rounded-2xl border border-black/10 bg-white/92 p-4 text-[#14121a] shadow-[0_24px_80px_rgba(20,18,26,0.18)] backdrop-blur-xl dark:border-white/10 dark:bg-[rgb(11_11_18/0.92)] dark:text-[#f2ede4] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
                  Support
                </p>
                <p className="mt-1 text-[12px] text-black/60 dark:text-white/60">
                  Keep the engine independent.
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss({ restoreFocus: true })}
                aria-label="Close support panel"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-black/10 text-black/60 transition-colors hover:bg-black/[0.04] hover:text-[#14121a] focus-visible:bg-black/[0.04] lg:h-7 lg:w-7 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-[#f2ede4] dark:focus-visible:bg-white/[0.06]"
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
              <Image
                src="/support-qr-cropped.webp"
                alt="PhonePe UPI QR code to support StrikeHike"
                width={359}
                height={359}
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
              <p className="mt-1 break-all font-mono text-[12px] tracking-[0.02em] text-black/60 dark:text-white/60">
                UPI ID: thisiskp22@axl
              </p>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
