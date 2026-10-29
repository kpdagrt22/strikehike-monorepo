"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "framer-motion";
import { ModeSwitch, viewForPath } from "@/components/ModeSwitch";
import { DUR, EASE, INTENT } from "@/lib/motion";
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

// Easter egg: while the views are revealed, the brand mark reads the sky. The
// tick for the Moon's nakshatra lights once home has loaded positions;
// otherwise all ticks stay unlit. Static, decorative, fetches nothing; it
// fades in and out with the views (opacity only).
function NakshatraHalo() {
  const moonLon = useChronoStore((state) => state.positions?.Moon?.lon);
  const lon = Number(moonLon);
  const lit =
    moonLon != null && Number.isFinite(lon)
      ? Math.floor(lon / NAKSHATRA_SPAN) % 27
      : -1;

  return (
    <motion.svg
      aria-hidden="true"
      data-egg="nakshatra-halo"
      viewBox="0 0 96 96"
      stroke="currentColor"
      strokeWidth="1.5"
      className="sh-halo text-black/35 dark:text-white/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: DUR.reveal, ease: EASE.out } }}
      exit={{ opacity: 0, transition: { duration: DUR.revealOut, ease: EASE.exit } }}
    >
      {HALO_TICKS.map((d, index) =>
        index === lit ? (
          <path key={d} d={d} data-lit="" stroke="#f05d49" strokeWidth="3" />
        ) : (
          <path key={d} d={d} />
        ),
      )}
    </motion.svg>
  );
}

// The glass of the corner chrome (Info, Feedback, Support), so the brand, and
// the cue over scrolled content, stay legible over the sky and the pages.
const GLASS =
  "border-black/10 bg-white/45 shadow-(--sh-shadow-float) backdrop-blur-2xl dark:border-white/10 dark:bg-black/40";

// Fixed top-left on every engine view: the mark and the wordmark, one link
// home. The halo rings the mark while the views are revealed.
function Brand({ halo }) {
  return (
    <Link
      href="/"
      prefetch={false}
      aria-label="strikehike.com — home"
      data-shell="brand"
      className={`pointer-events-auto absolute left-3 top-3 inline-flex h-12 items-center rounded-full border pr-4 max-[360px]:pr-3 text-[#14121a] transition-[background-color,border-color,scale] duration-(--sh-dur-micro) hover:border-[#f05d49]/35 hover:bg-white/65 focus-visible:border-[#f05d49]/35 focus-visible:bg-white/65 active:scale-[0.97] sm:left-5 sm:top-5 dark:text-[#f2ede4] dark:hover:border-[#ff8b77]/30 dark:hover:bg-black/55 dark:focus-visible:border-[#ff8b77]/30 dark:focus-visible:bg-black/55 ${GLASS}`}
    >
      <span className="relative grid h-[46px] w-[46px] shrink-0 place-items-center">
        <Image
          src="/icon.png"
          alt=""
          width={32}
          height={32}
          aria-hidden="true"
          draggable={false}
          className="h-8 w-8 rounded-full object-cover ring-1 ring-black/10 shadow-[0_0_16px_rgba(216,180,122,0.28)] dark:ring-white/10"
        />
        <AnimatePresence>
          {halo ? <NakshatraHalo key="halo" /> : null}
        </AnimatePresence>
      </span>
      <span className="ml-0.5 inline-flex items-baseline">
        <span className="text-strong font-semibold tracking-[-0.03em] max-[360px]:text-body">
          strikehike
        </span>
        <span className="text-micro font-medium tracking-[0.02em] text-[#c0442f] dark:text-[#ff8b77]">
          .com
        </span>
      </span>
    </Link>
  );
}

// The views open as one row in the top line only for a mouse, and only where
// the row fits beside the brand: from 720 px, with short labels until lg.
// With touch, or in a narrower window, they open as a list under the cue,
// which stays in place to toggle them.
const ROW_QUERY = "(min-width: 45rem) and (pointer: fine)";

function subscribeRowQuery(onChange) {
  const query = window.matchMedia(ROW_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const rowQueryMatches = () => window.matchMedia(ROW_QUERY).matches;
const rowQueryOnServer = () => false;

// The revealed views. While it plays its exit it is inert, so Tab and
// Shift+Tab skip links that are about to unmount and focus never drops to
// <body>. The row opens over the cue, under the pointer that opened it, so
// for a moment it swallows clicks: that pointer's next click (or a double
// click) confirms the views rather than landing on a tab or on the page
// beneath. With reduced motion it only fades.
function NavPanel({ layout, guarded, onConfirm, onNavigate }) {
  const isPresent = useIsPresent();
  const shift = useReducedMotion() ? {} : { y: -4, scale: 0.98 };

  const swallowClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onConfirm();
  };

  return (
    <motion.div
      id="site-nav-expanded"
      data-layout={layout}
      inert={!isPresent}
      onClickCapture={guarded ? swallowClick : undefined}
      initial={{ opacity: 0, ...shift }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        transition: { duration: DUR.reveal, ease: EASE.out },
      }}
      exit={{
        opacity: 0,
        ...shift,
        transition: { duration: DUR.revealOut, ease: EASE.exit },
      }}
      className={`pointer-events-auto absolute border border-black/10 bg-white/85 backdrop-blur-2xl dark:border-white/10 dark:bg-[rgb(11_11_18/0.85)] ${
        layout === "row"
          ? "left-1/2 top-5 flex h-12 w-max origin-top -translate-x-1/2 items-center rounded-full p-1 shadow-(--sh-shadow-float)"
          : "right-0 top-14 w-[13.5rem] origin-top-right rounded-2xl p-1.5 shadow-(--sh-shadow-overlay) sm:left-1/2 sm:right-auto sm:top-[4.75rem] sm:origin-top sm:-translate-x-1/2"
      }`}
    >
      <ModeSwitch layout={layout} onNavigate={onNavigate} />
    </motion.div>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const view = viewForPath(pathname);
  const rowCapable = useSyncExternalStore(
    subscribeRowQuery,
    rowQueryMatches,
    rowQueryOnServer,
  );
  const [open, setOpen] = useState(false);
  const [touchOpen, setTouchOpen] = useState(false);
  const [guarded, setGuarded] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // The scrolled page's scrollbar width, which the scrim leaves uncovered.
  const [gutter, setGutter] = useState(0);
  const [scrollPath, setScrollPath] = useState(pathname);
  const zoneRef = useRef(null);
  const cueRef = useRef(null);
  const openVia = useRef(null); // "hover" | "tab" | "click"
  const openedAt = useRef(0);
  const hovering = useRef(false);
  const press = useRef({ type: "", at: -Infinity });
  const hoverTimer = useRef(0);
  const closeTimer = useRef(0);
  const backstopTimer = useRef(0);
  const guardTimer = useRef(0);
  const layout = rowCapable && !touchOpen ? "row" : "list";

  // Each page scrolls its own <main>, so a new page starts unscrolled and the
  // cue drops the glass it took on the last one.
  if (scrollPath !== pathname) {
    setScrollPath(pathname);
    setScrolled(false);
  }

  const clearTimers = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(backstopTimer.current);
    window.clearTimeout(guardTimer.current);
  }, []);

  const show = useCallback((via, at, touch = false) => {
    openVia.current = via;
    openedAt.current = at;
    setTouchOpen(touch);
    setOpen(true);
    if (via === "tab") return;
    setGuarded(true);
    window.clearTimeout(guardTimer.current);
    guardTimer.current = window.setTimeout(
      () => setGuarded(false),
      INTENT.clickGuardMs,
    );
  }, []);

  // Keyboard focus only: a mouse click also leaves focus on the cue, and that
  // must not pin the views open.
  const keyboardFocusInside = useCallback(
    () => Boolean(zoneRef.current?.querySelector(":focus-visible")),
    [],
  );

  const close = useCallback(
    (restoreFocus = false) => {
      clearTimers();
      openVia.current = null;
      setOpen(false);
      setGuarded(false);
      if (restoreFocus) cueRef.current?.focus({ preventScroll: true });
    },
    [clearTimers],
  );

  // Auto-collapse backstop for views opened by a click or tap: paused while
  // the zone is hovered or holds keyboard focus.
  const armBackstop = useCallback(
    (focusLeaving = false) => {
      window.clearTimeout(backstopTimer.current);
      if (openVia.current !== "click") return;
      if (hovering.current || (!focusLeaving && keyboardFocusInside())) return;
      backstopTimer.current = window.setTimeout(
        () => close(),
        INTENT.autoCollapseMs,
      );
    },
    [close, keyboardFocusInside],
  );

  useEffect(() => clearTimers, [clearTimers]);

  // When a page scrolls under the top line, the cue takes the brand's glass
  // and the scrim closes the sky over the top line.
  useEffect(() => {
    const handleScroll = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.tagName !== "MAIN") return;
      setScrolled(target.scrollTop > 4);
      setGutter(target.offsetWidth - target.clientWidth);
    };
    const options = { capture: true, passive: true };
    document.addEventListener("scroll", handleScroll, options);
    return () => document.removeEventListener("scroll", handleScroll, options);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    armBackstop();
    const handleOutside = (event) => {
      if (!zoneRef.current?.contains(event.target)) close();
    };
    // On document, so it runs before window listeners (the planet readout);
    // marking Escape as handled means one press closes one layer.
    const handleKey = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      close(Boolean(zoneRef.current?.contains(document.activeElement)));
      event.preventDefault();
    };
    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close, armBackstop]);

  const handleHoverStart = useEffectEvent(() => {
    hovering.current = true;
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(backstopTimer.current);
    if (open) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(
      () => show("hover", performance.now()),
      INTENT.hoverOpenMs,
    );
  });

  const handleHoverEnd = useEffectEvent(() => {
    hovering.current = false;
    window.clearTimeout(hoverTimer.current);
    if (!open) return;
    // Hover-opened views close after a grace period, unless keyboard focus
    // is inside.
    if (openVia.current === "hover" && !keyboardFocusInside()) {
      closeTimer.current = window.setTimeout(
        () => close(),
        INTENT.hoverCloseMs,
      );
      return;
    }
    armBackstop();
  });

  // Mouse intent: the cue, the open views and, from sm, the band at top
  // centre. The band takes no pointer events, so the orrery or a page
  // scrolled beneath it stays reachable; the pointer is checked against the
  // band's box instead, measured when the band or the window resizes, never
  // during a move. A move with a button held (a drag, a text selection) is
  // not intent, and leaving the window leaves the band.
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return undefined;
    const band = window.matchMedia("(min-width: 40rem)");
    let box = null;
    let inside = false;
    const measure = () => {
      box = band.matches ? zone.getBoundingClientRect() : null;
    };
    const resize = new ResizeObserver(measure);
    resize.observe(zone);
    resize.observe(document.documentElement);
    const track = (next) => {
      if (next === inside) return;
      inside = next;
      if (next) handleHoverStart();
      else handleHoverEnd();
    };
    const handleMove = (event) => {
      if (event.pointerType !== "mouse" || event.buttons !== 0) return;
      track(
        zone.contains(event.target) ||
          (box !== null &&
            event.clientX >= box.left &&
            event.clientX < box.right &&
            event.clientY >= box.top &&
            event.clientY < box.bottom),
      );
    };
    const handleOut = (event) => {
      if (event.pointerType === "mouse" && !event.relatedTarget) track(false);
    };
    const options = { passive: true };
    document.addEventListener("pointermove", handleMove, options);
    document.addEventListener("pointerout", handleOut, options);
    return () => {
      resize.disconnect();
      document.removeEventListener("pointermove", handleMove, options);
      document.removeEventListener("pointerout", handleOut, options);
    };
  }, []);

  // Keyboard parity with hover: the Tab that lands on the cue reveals the
  // views; focus moved by script (Escape, dialogs closing) does not.
  const handleCueKeyUp = (event) => {
    if (event.key === "Tab" && !open) show("tab", event.timeStamp);
  };

  const handleCuePointerDown = (event) => {
    press.current = { type: event.pointerType, at: event.timeStamp };
  };

  const handleCueClick = (event) => {
    const last = press.current;
    press.current = { type: "", at: -Infinity };
    window.clearTimeout(hoverTimer.current);
    if (!open) {
      // A tap or a pen opens the list, so the cue stays where it was and the
      // next tap on it closes the views (touch laptops included).
      const touch =
        last.type !== "mouse" &&
        last.type !== "" &&
        event.timeStamp - last.at < 1000;
      show("click", event.timeStamp, touch);
      return;
    }
    // The click that follows a hover-open (or a Tab) confirms it rather than
    // closing the views the pointer just opened.
    if (
      openVia.current !== "click" &&
      event.timeStamp - openedAt.current < INTENT.clickGuardMs
    ) {
      openVia.current = "click";
      return;
    }
    close();
  };

  const confirmOpen = () => {
    openVia.current = "click";
  };

  const handleFocusCapture = () => {
    if (open && keyboardFocusInside()) {
      window.clearTimeout(backstopTimer.current);
    }
  };

  const handleBlurCapture = (event) => {
    const next = event.relatedTarget;
    if (!open || zoneRef.current?.contains(next)) return;
    // Tabbing (or clicking) on to the page closes the views; a window blur or
    // a still-hovering pointer only re-arms the backstop.
    if (next && !hovering.current) {
      close();
      return;
    }
    armBackstop(true);
  };

  const navigate = () =>
    close(Boolean(zoneRef.current?.contains(document.activeElement)));

  return (
    <header
      aria-label="StrikeHike"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70]"
    >
      {/* While a page scrolls under the top line, the sky closes over it and
          the page fades out above the clearance line, so nothing passes
          beneath the brand or the cue. It paints the engine sky (no visible
          edge) and leaves the page's scrollbar uncovered. Never over the
          orrery. */}
      {scrolled && view.href !== "/" ? (
        <div
          aria-hidden="true"
          data-shell="scrim"
          className="sh-scrim absolute left-0 top-0 h-(--sh-header-clear)"
          style={{ right: gutter }}
        />
      ) : null}

      <Brand halo={open} />

      {/* The views' zone. Phones: the cue sits at the right (left of Info on
          home) and opens a list beneath it. From sm: the band at top centre,
          72 px tall and as wide as the row it reveals. */}
      <div
        ref={zoneRef}
        id="site-nav-bubble"
        className={`absolute top-3 flex h-12 items-center ${
          view.href === "/" ? "right-[4.25rem]" : "right-3"
        } sm:inset-x-0 sm:top-0 sm:mx-auto sm:h-[4.5rem] sm:items-start sm:justify-center sm:pt-5 ${
          rowCapable ? "sm:w-[22.5rem] lg:w-[34rem]" : "sm:w-fit sm:px-8"
        }`}
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
      >
        {/* At rest the cue has no box for a mouse (the band reveals the
            views); on touch it keeps the faintest hairline, so it reads as a
            control. */}
        <button
          ref={cueRef}
          type="button"
          onPointerDown={handleCuePointerDown}
          onClick={handleCueClick}
          onKeyUp={handleCueKeyUp}
          aria-label={`${view.label}, StrikeHike navigation`}
          aria-expanded={open}
          aria-controls="site-nav-expanded"
          className={`pointer-events-auto inline-flex h-12 items-center gap-1.5 rounded-full border px-3 text-micro font-medium uppercase tracking-[0.14em] text-black/60 transition-[color,background-color,border-color,box-shadow,backdrop-filter,opacity] duration-(--sh-dur-micro) hover:text-black/80 focus-visible:text-black/80 dark:text-white/60 dark:hover:text-white/80 dark:focus-visible:text-white/80 ${
            scrolled
              ? GLASS
              : "border-transparent pointer-coarse:border-black/10 dark:pointer-coarse:border-white/10"
          } ${open && layout === "row" ? "opacity-0" : ""}`}
        >
          <span
            aria-hidden="true"
            className="h-1 w-1 shrink-0 rounded-full bg-[#c0442f] dark:bg-[#ff8b77]"
          />
          {view.short ? (
            <>
              <span className="sm:hidden">{view.short}</span>
              <span className="hidden sm:inline">{view.label}</span>
            </>
          ) : (
            <span>{view.label}</span>
          )}
        </button>

        <AnimatePresence initial={false}>
          {open ? (
            <NavPanel
              key="views"
              layout={layout}
              guarded={guarded && layout === "row"}
              onConfirm={confirmOpen}
              onNavigate={navigate}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </header>
  );
}
