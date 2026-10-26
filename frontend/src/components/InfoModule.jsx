"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const INITIAL_FORM = { name: "", email: "", query: "" };

export function InfoModule() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [transmitted, setTransmitted] = useState(false);
  const timerRef = useRef(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    setForm(INITIAL_FORM);
    setTransmitted(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setTransmitted(false), 3200);
  };

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
  };

  return (
    <div
      id="contact"
      className="fixed right-3 top-3 z-[60] flex flex-col items-end sm:right-5 sm:top-5"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
    >
      <button
        type="button"
        aria-label="Open information and contact"
        aria-expanded={open}
        aria-controls="strikehike-info-panel"
        onClick={() => setOpen(true)}
        className="group grid h-11 w-11 place-items-center rounded-full border border-black/10 bg-white/45 text-black/55 shadow-[0_10px_30px_rgba(20,18,26,0.12)] backdrop-blur-xl transition-colors hover:border-[#f05d49]/40 hover:text-[#c0442f] dark:border-white/15 dark:bg-black/30 dark:text-white/60 dark:hover:border-[#ff8b77]/40 dark:hover:text-[#ff8b77]"
      >
        <span className="relative grid h-5 w-5 place-items-center">
          <span className="absolute inset-0 rounded-full border border-current opacity-30 transition-opacity group-hover:opacity-60" />
          <span className="h-1 w-1 rounded-full bg-[#f05d49] shadow-[0_0_8px_rgba(240,93,73,0.8)]" />
          <span className="absolute -bottom-0.5 right-0.5 text-[10px] font-medium leading-none">
            i
          </span>
        </span>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.section
            id="strikehike-info-panel"
            role="region"
            aria-label="About StrikeHike and contact"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="mt-3 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-black/45 p-5 text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <p className="text-micro font-medium uppercase tracking-[0.18em] text-white/45">
                About the engine
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close information panel"
                className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/70"
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

            <p className="mt-3 text-body leading-relaxed text-white/70">
              StrikeHike is a Universal Chrono-Spatial Engine that maps a
              120-year ML index of market regimes, volatility and world events
              against planetary geometry. It surfaces deep historical parallels
              and recent manifestations of the same conditions, so patterns can
              be examined without mistaking correlation for certainty.
            </p>

            <div className="mt-5 border-t border-white/10 pt-5">
              <p className="text-micro font-medium uppercase tracking-[0.18em] text-white/45">
                Enquiry
              </p>

              <form onSubmit={handleSubmit} className="mt-3 space-y-3">
                <label className="sr-only" htmlFor="info-name">
                  Name
                </label>
                <input
                  id="info-name"
                  name="name"
                  value={form.name}
                  onChange={updateField("name")}
                  placeholder="Name"
                  autoComplete="name"
                  className="info-input"
                  required
                />

                <label className="sr-only" htmlFor="info-email">
                  Email
                </label>
                <input
                  id="info-email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={updateField("email")}
                  placeholder="Email"
                  autoComplete="email"
                  className="info-input"
                  required
                />

                <label className="sr-only" htmlFor="info-query">
                  Query
                </label>
                <input
                  id="info-query"
                  name="query"
                  value={form.query}
                  onChange={updateField("query")}
                  placeholder="Query"
                  className="info-input"
                  required
                />

                <div className="flex items-center justify-between gap-3 pt-1">
                  <span
                    aria-live="polite"
                    className={`text-micro font-medium uppercase tracking-[0.12em] transition-opacity ${
                      transmitted
                        ? "text-[#5eead4] opacity-100"
                        : "opacity-0"
                    }`}
                  >
                    {transmitted ? "Message Transmitted" : ""}
                  </span>

                  <button
                    type="submit"
                    className="min-h-11 rounded-full border border-[#f05d49]/40 px-5 text-micro font-medium uppercase tracking-[0.16em] text-[#ffb4a6] transition-colors hover:border-[#f05d49]/70 hover:bg-[#f05d49]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f05d49]/50"
                  >
                    Send
                  </button>
                </div>
              </form>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
