"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ModeSwitch } from "@/components/ModeSwitch";
import { INTENT, SPRING } from "@/lib/motion";
import { useChronoStore } from "@/store/chronoStore";

const NAKSHATRA_SPAN = 360 / 27;

// 27 hairline ticks around the logo, laid out like the orrery's Nakshatra
// ring (0° at three o'clock, every third tick long). 96-unit box, 0.5 px grid.
const HALO_TICKS = Array.from({ length: 27 }, (_, index) => {
  const angle = (index / 27) * Math.PI * 2;
  const inner = index % 3 === 0 ? 35 : 37.5;
  const point = (radius) =>
    `${Math.round(48 + Math.cos(angle) * radius)} ${Math.round(48 + Math.sin(angle) * radius)}`;
  return `M${point(inner)}L${point(42.5)}`;
});

// Easter egg: when the nav opens, the brand mark reads the sky. The tick for
// the Moon's nakshatra lights once home has loaded positions; otherwise all
// ticks stay unlit. Static, decorative, fetches nothing.
function NakshatraHalo() {
  const moonLon = useChronoStore((state) => state.positions?.Moon?.lon);
  const lon = Number(moonLon);
  const lit =
    moonLon != null && Number.isFinite(lon)
      ? Math.floor(lon / NAKSHATRA_SPAN) % 27
      : -1;

  return (
    <svg
      aria-hidden="true"
      data-egg="nakshatra-halo"
      viewBox="0 0 96 96"
      stroke="currentColor"
      strokeWidth="1.5"
      className="sh-halo text-black/35 dark:text-white/40"
    >
      {HALO_TICKS.map((d, index) =>
        index === lit ? (
          <path key={d} d={d} data-lit="" stroke="#f05d49" strokeWidth="3" />
        ) : (
          <path key={d} d={d} />
        ),
      )}
    </svg>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const headerRef = useRef(null);
  const toggleRef = useRef(null);
  const openVia = useRef(null); // "hover" | "tab" | "click"
  const openedAt = useRef(0);
  const hovering = useRef(false);
  const hoverTimer = useRef(0);
  const closeTimer = useRef(0);
  const backstopTimer = useRef(0);

  const clearTimers = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(backstopTimer.current);
  }, []);

  const show = useCallback((via, at) => {
    openVia.current = via;
    openedAt.current = at;
    setOpen(true);
  }, []);

  // Keyboard focus only: a mouse click also leaves focus on the toggle, and
  // that must not pin the pill open.
  const keyboardFocusInside = useCallback(
    () => Boolean(headerRef.current?.querySelector(":focus-visible")),
    [],
  );

  const close = useCallback(
    (restoreFocus = false) => {
      clearTimers();
      openVia.current = null;
      setOpen(false);
      if (restoreFocus) toggleRef.current?.focus({ preventScroll: true });
    },
    [clearTimers],
  );

  // Auto-collapse backstop: paused while the header is hovered or focused.
  const armBackstop = useCallback(
    (focusLeaving = false) => {
      window.clearTimeout(backstopTimer.current);
      if (hovering.current || (!focusLeaving && keyboardFocusInside())) return;
      backstopTimer.current = window.setTimeout(
        () => close(),
        INTENT.autoCollapseMs,
      );
    },
    [close, keyboardFocusInside],
  );

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!open) return undefined;
    armBackstop();
    const handleOutside = (event) => {
      if (!headerRef.current?.contains(event.target)) close();
    };
    const handleKey = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      close(Boolean(headerRef.current?.contains(document.activeElement)));
    };
    document.addEventListener("pointerdown", handleOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, close, armBackstop]);

  const handlePointerEnter = (event) => {
    if (event.pointerType !== "mouse") return;
    hovering.current = true;
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(backstopTimer.current);
    if (open) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(
      () => show("hover", performance.now()),
      INTENT.hoverOpenMs,
    );
  };

  const handlePointerLeave = (event) => {
    if (event.pointerType !== "mouse") return;
    hovering.current = false;
    window.clearTimeout(hoverTimer.current);
    if (!open) return;
    // A hover-opened pill closes after a grace period, unless keyboard focus
    // is inside.
    if (openVia.current === "hover" && !keyboardFocusInside()) {
      closeTimer.current = window.setTimeout(
        () => close(),
        INTENT.hoverCloseMs,
      );
      return;
    }
    armBackstop();
  };

  // Keyboard parity with hover: the Tab that lands on the toggle opens the
  // pill; focus moved by script (Escape, dialogs closing) does not.
  const handleToggleKeyUp = (event) => {
    if (event.key === "Tab" && !open) show("tab", event.timeStamp);
  };

  const handleToggleClick = (event) => {
    window.clearTimeout(hoverTimer.current);
    if (!open) {
      show("click", event.timeStamp);
      return;
    }
    // The click that follows a hover-open (or a Tab) confirms it rather than
    // closing the pill the pointer just opened.
    if (
      openVia.current !== "click" &&
      event.timeStamp - openedAt.current < INTENT.clickGuardMs
    ) {
      openVia.current = "click";
      return;
    }
    close();
  };

  const handleFocusCapture = () => {
    if (open && keyboardFocusInside()) {
      window.clearTimeout(backstopTimer.current);
    }
  };

  const handleBlurCapture = (event) => {
    const next = event.relatedTarget;
    if (!open || headerRef.current?.contains(next)) return;
    // Tabbing (or clicking) on to the page closes the pill; a window blur or
    // a still-hovering pointer only re-arms the backstop.
    if (next && !hovering.current) {
      close();
      return;
    }
    armBackstop(true);
  };

  const navigate = () =>
    close(Boolean(headerRef.current?.contains(document.activeElement)));

  return (
    <header
      ref={headerRef}
      id="site-nav-bubble"
      className="pointer-events-none fixed right-2 top-2 z-[70] flex max-w-[calc(100vw-1rem)] flex-row-reverse items-center sm:right-5 sm:top-5"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      aria-label="StrikeHike navigation"
    >
      <button
        ref={toggleRef}
        type="button"
        onClick={handleToggleClick}
        onKeyUp={handleToggleKeyUp}
        aria-label="Open StrikeHike navigation"
        aria-expanded={open}
        aria-controls="site-nav-expanded"
        className={`pointer-events-auto relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-full border text-[#14121a] transition-[background-color,border-color,box-shadow,scale] duration-(--sh-dur-micro) active:scale-[0.97] dark:text-[#f2ede4] ${
          open
            ? "border-transparent bg-transparent hover:bg-black/[0.04] focus-visible:bg-black/[0.04] dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
            : "border-black/10 bg-white/45 shadow-[0_14px_44px_rgba(20,18,26,0.18)] backdrop-blur-2xl hover:border-[#f05d49]/35 hover:bg-white/65 focus-visible:border-[#f05d49]/35 focus-visible:bg-white/65 dark:border-white/10 dark:bg-black/40 dark:shadow-[0_14px_44px_rgba(0,0,0,0.55)] dark:hover:border-[#ff8b77]/30 dark:hover:bg-black/55 dark:focus-visible:border-[#ff8b77]/30 dark:focus-visible:bg-black/55"
        }`}
      >
        <Image
          src="/icon.png"
          alt=""
          width={32}
          height={32}
          aria-hidden="true"
          draggable={false}
          className="h-8 w-8 rounded-full object-cover ring-1 ring-black/10 shadow-[0_0_16px_rgba(216,180,122,0.28)] dark:ring-white/10"
        />
        {open ? <NakshatraHalo /> : null}
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="expanded"
            id="site-nav-expanded"
            initial={{ opacity: 0, x: 16, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 12, scale: 0.98 }}
            transition={SPRING.panel}
            className="pointer-events-auto -mr-12 flex h-12 min-w-0 origin-right items-center gap-1 rounded-full border border-black/10 bg-white/60 py-1 pl-2 pr-[3.25rem] shadow-[0_18px_60px_rgba(20,18,26,0.18)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#0b0b12]/70 dark:shadow-[0_18px_60px_rgba(0,0,0,0.6)] sm:gap-2 sm:pl-2.5"
          >
            <Link
              href="/"
              prefetch={false}
              onClick={navigate}
              aria-label="strikehike.com — home"
              className="hidden shrink-0 items-baseline rounded-full px-2 py-1.5 text-[#14121a] transition-colors hover:bg-black/[0.04] focus-visible:bg-black/[0.04] min-[460px]:inline-flex dark:text-[#f2ede4] dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
            >
              <span className="text-strong font-semibold tracking-[-0.03em]">
                strikehike
              </span>
              <span className="text-micro font-medium tracking-[0.02em] text-[#c0442f] dark:text-[#ff8b77]">
                .com
              </span>
            </Link>

            <div className="min-w-0">
              <ModeSwitch onNavigate={navigate} variant="bare" />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
