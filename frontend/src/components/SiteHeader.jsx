"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { viewOpened } from "@/lib/analytics/events";
import { ModeSwitch, viewForPath } from "@/components/ModeSwitch";
import { SoundToggle } from "@/components/SoundToggle";
import { useDismissable } from "@/hooks/useDismissable";
import { DUR, EASE } from "@/lib/motion";
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

// Easter egg: while the menu is open, the brand mark reads the sky. The tick
// for the Moon's nakshatra lights once home has loaded positions.
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
      className="sh-halo text-(--sh-text-4)"
      initial={{ opacity: 0 }}
      animate={{
        opacity: 1,
        transition: { duration: DUR.reveal, ease: EASE.out },
      }}
      exit={{
        opacity: 0,
        transition: { duration: DUR.revealOut, ease: EASE.exit },
      }}
    >
      {HALO_TICKS.map((d, index) =>
        index === lit ? (
          <path
            key={d}
            d={d}
            data-lit=""
            stroke="var(--sh-signal)"
            strokeWidth="3"
          />
        ) : (
          <path key={d} d={d} />
        ),
      )}
    </motion.svg>
  );
}

const GLASS =
  "border-black/10 bg-white/45 shadow-(--sh-shadow-float) backdrop-blur-2xl dark:border-white/10 dark:bg-black/40";

function Brand({ halo }) {
  return (
    <Link
      href="/"
      prefetch={false}
      aria-label="strikehike.com - home"
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

export function SiteHeader() {
  const pathname = usePathname();
  const view = viewForPath(pathname);
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [gutter, setGutter] = useState(0);
  const [scrollPath, setScrollPath] = useState(pathname);
  const triggerRef = useRef(null);
  const containerRef = useRef(null);
  const navTracked = useRef(false);

  useEffect(() => {
    navTracked.current = false;
  }, [pathname]);

  useDismissable(open, {
    onClose: () => setOpen(false),
    triggerRef,
    containerRef,
    closeOnOutside: true,
  });

  if (scrollPath !== pathname) {
    setScrollPath(pathname);
    setScrolled(false);
  }

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

  const handleNavClick = (event) => {
    if (!navTracked.current) {
      navTracked.current = true;
      viewOpened("nav", event.detail === 0 ? "keyboard" : "click");
    }
    setOpen(false);
  };

  const menuRight = view.href === "/" ? "right-[4.5rem]" : "right-3 sm:right-5";

  return (
    <header
      aria-label="StrikeHike"
      className="pointer-events-none fixed inset-x-0 top-0 z-[70]"
    >
      {scrolled && view.href !== "/" ? (
        <div
          aria-hidden="true"
          data-shell="scrim"
          className="sh-scrim absolute left-0 top-0 h-(--sh-header-clear)"
          style={{ right: gutter }}
        />
      ) : null}

      <Brand halo={open} />

      {/* Desktop: the five views, always present, centred in the space
          between the brand and the menu. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-[4.5rem] items-start justify-center pl-[11rem] pr-[7rem] pt-3 sm:flex lg:pr-[11rem]">
        <div
          data-shell="nav-pill"
          className="pointer-events-auto rounded-full border border-(--sh-line-1) bg-(--sh-surface-float) p-1 shadow-(--sh-shadow-float) backdrop-blur-xl"
        >
          <ModeSwitch layout="row" onNavigate={handleNavClick} />
        </div>
      </div>

      {/* Phone: a compact, scrollable row under the header. */}
      <div
        data-shell="nav-row"
        className="pointer-events-auto absolute inset-x-0 top-[4.25rem] z-[69] border-b border-(--sh-line-1) bg-(--sh-surface-float) backdrop-blur-xl sm:hidden"
      >
        <ModeSwitch layout="scroll" onNavigate={handleNavClick} />
      </div>

      <div
        className={`pointer-events-auto absolute top-3 flex items-start gap-2 sm:top-5 ${menuRight}`}
      >
        <SoundToggle />
        <div ref={containerRef} className="relative">
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={open ? "site-nav-menu" : undefined}
            aria-label="StrikeHike menu"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-(--sh-line-1) bg-(--sh-surface-float) text-(--sh-text-2) shadow-(--sh-shadow-float) backdrop-blur-xl transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) focus-visible:text-(--sh-text-1)"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.35"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {open ? (
            <div
              id="site-nav-menu"
              className="absolute right-0 top-full mt-2 w-[14rem] rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-overlay) p-1.5 shadow-(--sh-shadow-overlay)"
            >
              <ModeSwitch layout="list" onNavigate={handleNavClick} />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
