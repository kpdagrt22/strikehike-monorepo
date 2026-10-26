"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useChronoStore } from "@/store/chronoStore";

export function FeedbackModule() {
  const [open, setOpen] = useState(false);
  const [thoughts, setThoughts] = useState("");
  const [received, setReceived] = useState(false);
  const timerRef = useRef(null);
  const timeControlsExpanded = useChronoStore(
    (state) => state.timeControlsExpanded,
  );

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
      // Private-mode storage can fail; the confirmation still works.
    }

    setThoughts("");
    setReceived(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setReceived(false), 4000);
  };

  return (
    <div
      className={`pointer-events-auto fixed bottom-32 left-6 z-30 flex flex-col items-start gap-3 lg:bottom-6 lg:left-6 ${
        timeControlsExpanded ? "max-lg:hidden" : ""
      }`}
    >
      <AnimatePresence initial={false}>
        {open ? (
          <motion.section
            id="strikehike-feedback-panel"
            role="region"
            aria-label="Share feedback"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.985 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="w-[min(20rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-black/10 bg-white/80 p-4 text-[#14121a] shadow-[0_24px_80px_rgba(20,18,26,0.2)] backdrop-blur-xl dark:border-white/10 dark:bg-black/40 dark:text-[#f2ede4] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[8px] font-medium uppercase tracking-[0.22em] text-black/40 dark:text-white/35">
                  Feedback
                </p>
                <p className="mt-1 text-[12px] text-black/55 dark:text-white/50">
                  Tell us what is working, or what is not.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close feedback panel"
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

            <form onSubmit={submit} className="mt-3">
              <label htmlFor="strikehike-thoughts" className="sr-only">
                Your Thoughts
              </label>
              <textarea
                id="strikehike-thoughts"
                value={thoughts}
                onChange={(event) => setThoughts(event.target.value)}
                placeholder="Your Thoughts"
                rows={4}
                className="w-full resize-none rounded-xl border border-black/10 bg-black/[0.025] px-3 py-2.5 text-[11px] leading-relaxed text-black/70 outline-none transition-colors placeholder:text-black/30 focus:border-[#f05d49]/40 focus:bg-black/[0.04] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70 dark:placeholder:text-white/25 dark:focus:border-[#ff8b77]/40 dark:focus:bg-white/[0.06]"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span
                  aria-live="polite"
                  className={`text-[8px] font-medium uppercase tracking-[0.12em] transition-opacity ${
                    received
                      ? "text-[#0f766e] opacity-100 dark:text-[#5eead4]"
                      : "opacity-0"
                  }`}
                >
                  {received ? "Thank you — received" : ""}
                </span>
                <button
                  type="submit"
                  disabled={!thoughts.trim()}
                  className="rounded-full bg-[#f05d49] px-4 py-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-white shadow-[0_0_20px_rgba(240,93,73,0.25)] transition-colors hover:bg-[#e8533f] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Send
                </button>
              </div>
            </form>
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
          aria-label="Open feedback"
          aria-expanded={open}
          aria-controls="strikehike-feedback-panel"
          className="grid h-11 w-11 place-items-center rounded-full border border-black/10 bg-white/45 text-black/55 shadow-[0_12px_38px_rgba(20,18,26,0.15)] backdrop-blur-xl transition-colors hover:border-[#f05d49]/40 hover:text-[#c0442f] dark:border-white/15 dark:bg-black/30 dark:text-white/60 dark:hover:border-[#ff8b77]/40 dark:hover:text-[#ff8b77]"
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
      </motion.div>
    </div>
  );
}
