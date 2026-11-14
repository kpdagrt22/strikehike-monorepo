"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useAnimationControls } from "framer-motion";
import { viewOpened } from "@/lib/analytics/events";
import { CONTACT_URL } from "@/lib/contact";
import { INTENT, reveal } from "@/lib/motion";
import { SiteColophon } from "@/components/seo/SiteColophon";

// The panel covers the alignment panel, so a hover preview waits a touch
// longer than the nav's intent delay.
const HOVER_PREVIEW_MS = 150;

// The other views and the disclaimer, as plain links.
const VIEWS = [
  { href: "/regime", label: "Regime" },
  { href: "/convergence", label: "Convergence" },
  { href: "/patterns", label: "Study of Patterns" },
  { href: "/disclaimer", label: "Disclaimer" },
];

// Three short research doors from the home page, so the server HTML links
// every key area even before the orrery's JavaScript arrives.
const RESEARCH = [
  {
    href: "/tested",
    label: "Tested",
    what: "Seven popular claims, measured against the daily S&P 500 record.",
  },
  {
    href: "/recessions",
    label: "Recessions",
    what: "Every NBER recession since 1854, on one timeline.",
  },
  {
    href: "/declines",
    label: "20% falls",
    what: "Market declines since 1871, compared side by side.",
  },
];

const LINK =
  "inline-flex min-h-6 items-center text-micro text-black/60 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] pointer-coarse:min-h-11 dark:text-white/60 dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]";

export function InfoModule() {
  const [open, setOpen] = useState(false);
  // The panel is always in the page, so the server HTML carries it. While
  // closed it is `hidden`: out of view, out of the tab order and out of the
  // accessibility tree. It hides only once its exit has played.
  const [panelHidden, setPanelHidden] = useState(true);
  const controls = useAnimationControls();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const openVia = useRef(null); // "hover" | "tab" | "click"
  const openedAt = useRef(0);
  const hovering = useRef(false);
  const hoverTimer = useRef(0);
  const closeTimer = useRef(0);

  const clearTimers = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  // `trackAs` separates the counted method from `via`, which drives the
  // click guard. Hover and Tab previews are not counted; a click is.
  const show = useCallback((via, at, trackAs = via) => {
    openVia.current = via;
    openedAt.current = at;
    if (trackAs === "click" || trackAs === "hash") viewOpened("info", trackAs);
    setPanelHidden(false);
    setOpen(true);
  }, []);

  const hide = useCallback(
    (restoreFocus = false) => {
      clearTimers();
      openVia.current = null;
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    },
    [clearTimers],
  );

  useEffect(() => clearTimers, [clearTimers]);

  // Open plays reveal.initial → reveal.animate; close plays reveal.exit and
  // then hides the panel, unless it was opened again in the meantime.
  useEffect(() => {
    let current = true;
    if (open) {
      controls.set("initial");
      controls.start("animate");
    } else {
      controls.start("exit").then(() => {
        if (current) setPanelHidden(true);
      });
    }
    return () => {
      current = false;
    };
  }, [open, controls]);

  // /#contact (older links; the JSON-LD contact point is now thisiskp.in's
  // enquiry form) arrives with the panel open.
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#contact") {
        show("click", performance.now(), "hash");
      }
    };
    const frame = window.requestAnimationFrame(openFromHash);
    window.addEventListener("hashchange", openFromHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", openFromHash);
    };
  }, [show]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) hide();
    };
    // On document, so it runs before window listeners (the planet readout);
    // marking Escape as handled means one press closes one layer.
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      hide(Boolean(rootRef.current?.contains(document.activeElement)));
      event.preventDefault();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, hide]);

  const handlePointerEnter = (event) => {
    if (event.pointerType !== "mouse") return;
    hovering.current = true;
    window.clearTimeout(closeTimer.current);
    if (open) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(
      () => show("hover", performance.now()),
      HOVER_PREVIEW_MS,
    );
  };

  const handlePointerLeave = (event) => {
    if (event.pointerType !== "mouse") return;
    hovering.current = false;
    window.clearTimeout(hoverTimer.current);
    // Only a hover preview closes on leave, and never with keyboard focus
    // inside (a mouse click also leaves focus on the trigger).
    if (!open || openVia.current !== "hover") return;
    if (rootRef.current?.querySelector(":focus-visible")) return;
    closeTimer.current = window.setTimeout(() => hide(), INTENT.hoverCloseMs);
  };

  // Keyboard parity with hover: the Tab that lands on the trigger previews
  // the panel; focus moved by script (Escape, dialogs) does not.
  const handleTriggerKeyUp = (event) => {
    if (event.key === "Tab" && !open) show("tab", event.timeStamp);
  };

  const handleTriggerClick = (event) => {
    window.clearTimeout(hoverTimer.current);
    if (!open) {
      show("click", event.timeStamp);
      return;
    }
    // A click that follows a hover or Tab preview confirms it.
    if (
      openVia.current !== "click" &&
      event.timeStamp - openedAt.current < INTENT.clickGuardMs
    ) {
      openVia.current = "click";
      viewOpened("info", "click");
      return;
    }
    hide();
  };

  const handleBlurCapture = (event) => {
    const next = event.relatedTarget;
    if (!open || !next || rootRef.current?.contains(next)) return;
    if (!hovering.current) hide();
  };

  return (
    <div
      ref={rootRef}
      id="contact"
      className="fixed right-3 top-3 z-[60] flex flex-col items-end sm:right-5 sm:top-5"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onBlurCapture={handleBlurCapture}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open information and contact"
        aria-expanded={open}
        aria-controls="strikehike-info-panel"
        onClick={handleTriggerClick}
        onKeyUp={handleTriggerKeyUp}
        className="group grid h-12 w-12 place-items-center rounded-full border border-black/10 bg-white/45 text-black/60 shadow-(--sh-shadow-float) backdrop-blur-2xl transition-[color,border-color] hover:border-[#f05d49]/40 hover:text-[#c0442f] focus-visible:border-[#f05d49]/40 focus-visible:text-[#c0442f] dark:border-white/10 dark:bg-black/40 dark:text-white/60 dark:hover:border-[#ff8b77]/40 dark:hover:text-[#ff8b77] dark:focus-visible:border-[#ff8b77]/40 dark:focus-visible:text-[#ff8b77]"
      >
        <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
          <circle
            cx="10"
            cy="10"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            className="opacity-30 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60"
          />
          <circle cx="10" cy="6.3" r="1.6" fill="#f05d49" />
          <path
            d="M10 9.4v5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <motion.section
        id="strikehike-info-panel"
        role="region"
        aria-label="About StrikeHike and contact"
        hidden={panelHidden}
        variants={reveal}
        initial="initial"
        animate={controls}
        className="mt-3 w-[min(22rem,calc(100vw-1.5rem))] origin-top-right overflow-y-auto rounded-2xl border border-black/10 bg-(--sh-surface-overlay) p-5 text-[#14121a] shadow-(--sh-shadow-overlay) backdrop-blur-xl dark:border-white/10 dark:text-[#f2ede4] max-h-[calc(100dvh-6rem)]"
      >
        <div className="flex items-start justify-between gap-4">
          <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
            About the engine
          </p>
          <button
            type="button"
            onClick={() => hide(true)}
            aria-label="Close information panel"
            className="relative grid h-8 w-8 place-items-center rounded-full border border-black/10 text-black/60 transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-black/[0.04] hover:text-black/80 focus-visible:bg-black/[0.04] focus-visible:text-black/80 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white/80 dark:focus-visible:bg-white/[0.06] dark:focus-visible:text-white/80"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <p className="mt-3 text-body leading-relaxed text-black/70 dark:text-white/70">
          StrikeHike sets the US market and macro record beside the planetary
          sky, date by date: a 3D orrery, every NBER recession since 1854, a
          weekly Core Index of US market trend and stress, and a catalogue of
          market declines since 1871. It describes the past, so patterns can be
          examined without mistaking correlation for certainty.
        </p>

        <p
          id="info-views-label"
          className="mt-4 text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60"
        >
          Views
        </p>
        <nav
          aria-labelledby="info-views-label"
          className="mt-1 flex flex-wrap items-center gap-x-3"
        >
          {VIEWS.map((view) => (
            <Link
              key={view.href}
              href={view.href}
              prefetch={false}
              className={LINK}
            >
              {view.label}
            </Link>
          ))}
        </nav>
        <p className="mt-4 text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
          Research
        </p>
        <ul className="mt-1 space-y-2">
          {RESEARCH.map((item) => (
            <li
              key={item.href}
              className="text-micro leading-snug text-black/60 dark:text-white/60"
            >
              <Link href={item.href} prefetch={false} className={LINK}>
                {item.label}
              </Link>
              {" — "}
              {item.what}
            </li>
          ))}
        </ul>
        <p className="mt-1 flex flex-wrap items-center gap-x-1 text-micro text-black/60 dark:text-white/60">
          <span>Built and run by</span>
          <a href="https://thisiskp.in" rel="author" className={LINK}>
            Prakash Kantumutchu (KP)
          </a>
        </p>

        <div className="mt-5 border-t border-black/10 pt-5 dark:border-white/10">
          <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
            Enquiry
          </p>
          <a
            href={CONTACT_URL}
            target="_blank"
            rel="noopener"
            aria-describedby="info-enquiry-note"
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#f05d49]/40 px-5 text-micro font-medium uppercase tracking-[0.16em] text-[#c0442f] transition-colors hover:border-[#f05d49]/70 hover:bg-black/[0.04] focus-visible:border-[#f05d49]/70 focus-visible:bg-black/[0.04] dark:text-[#ff8b77] dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
          >
            Write to KP
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5.5 10.5l5-5M6.5 5.5h4v4" />
            </svg>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <p
            id="info-enquiry-note"
            className="mt-2 text-micro text-black/60 dark:text-white/60"
          >
            Opens the enquiry form on thisiskp.in
          </p>
        </div>
        <div data-home-colophon className="mt-4">
          <SiteColophon current="/" compact />
        </div>
      </motion.section>
    </div>
  );
}
