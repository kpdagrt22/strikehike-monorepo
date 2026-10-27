"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDismissable } from "@/hooks/useDismissable";
import { useChronoStore } from "@/store/chronoStore";
import { useEntityStore } from "@/store/entityStore";

export function FeedbackModule() {
  const [open, setOpen] = useState(false);
  const [thoughts, setThoughts] = useState("");
  const [saved, setSaved] = useState(false);
  const timerRef = useRef(null);
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

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const submit = (event) => {
    event.preventDefault();
    const message = thoughts.trim();
    if (!message) return;

    try {
      const existing = JSON.parse(
        localStorage.getItem("strikehike.feedback") || "[]",
      );
      localStorage.setItem(
        "strikehike.feedback",
        JSON.stringify(
          [
            ...(Array.isArray(existing) ? existing : []),
            { message, date: new Date().toISOString() },
          ].slice(-20),
        ),
      );
    } catch {
      // Storage can be unavailable (private mode). Keep the text rather than
      // claim a save that did not happen.
      return;
    }

    setThoughts("");
    setSaved(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSaved(false), 4000);
  };

  return (
    <div
      className={`pointer-events-auto fixed bottom-32 left-6 z-30 flex flex-col-reverse items-start gap-3 lg:bottom-6 lg:left-6 ${
        timeControlsExpanded || mobileSheet || readoutPinned
          ? "max-lg:hidden"
          : ""
      }`}
    >
      {/* Trigger first in the DOM so Tab moves from it into the open panel;
          flex-col-reverse keeps the panel visually above it. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open feedback"
        aria-expanded={open}
        aria-controls="strikehike-feedback-panel"
        className="grid h-11 w-11 place-items-center rounded-full border border-black/10 bg-white/45 text-black/60 shadow-[0_12px_38px_rgba(20,18,26,0.15)] backdrop-blur-xl transition-[color,background-color,scale] duration-[140ms] hover:bg-white/65 hover:text-[#14121a] focus-visible:bg-white/65 focus-visible:text-[#14121a] active:scale-[0.97] dark:border-white/15 dark:bg-black/30 dark:text-white/60 dark:hover:bg-black/45 dark:hover:text-[#f2ede4] dark:focus-visible:bg-black/45 dark:focus-visible:text-[#f2ede4]"
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
          <path d="M5 5.5h14v10H10l-4 3v-3H5z" />
          <path d="M8.5 9.5h7M8.5 12.5h4" />
        </svg>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            ref={panelRef}
            id="strikehike-feedback-panel"
            role="region"
            aria-label="Share feedback"
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
            className="w-[min(20rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-black/10 bg-white/92 p-4 text-[#14121a] shadow-[0_24px_80px_rgba(20,18,26,0.18)] backdrop-blur-xl dark:border-white/10 dark:bg-[rgb(11_11_18/0.92)] dark:text-[#f2ede4] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
                  Feedback
                </p>
                <p className="mt-1 text-[12px] text-black/60 dark:text-white/60">
                  Tell us what is working, or what is not.
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss({ restoreFocus: true })}
                aria-label="Close feedback panel"
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

            <form onSubmit={submit} className="mt-3">
              <label
                htmlFor="strikehike-thoughts"
                className="block text-micro font-medium text-black/60 dark:text-white/60"
              >
                Your thoughts
              </label>
              <textarea
                id="strikehike-thoughts"
                value={thoughts}
                onChange={(event) => setThoughts(event.target.value)}
                rows={4}
                className="mt-1.5 w-full resize-none rounded-xl border border-black/10 bg-black/[0.025] px-3 py-2.5 text-meta leading-relaxed text-black/80 transition-colors focus:bg-black/[0.04] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/80 dark:focus:bg-white/[0.06]"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span
                  aria-live="polite"
                  className={`text-micro font-medium transition-opacity ${
                    saved
                      ? "text-[#0f766e] opacity-100 dark:text-[#5eead4]"
                      : "opacity-0"
                  }`}
                >
                  {saved ? "Saved on this device only." : ""}
                </span>
                <button
                  type="submit"
                  disabled={!thoughts.trim()}
                  className="h-11 shrink-0 rounded-full bg-[#f05d49] px-4 text-micro font-medium uppercase tracking-[0.14em] text-[#14121a] transition-colors hover:bg-[#e8533f] disabled:cursor-not-allowed disabled:opacity-[0.38] lg:h-9"
                >
                  Send
                </button>
              </div>
            </form>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
