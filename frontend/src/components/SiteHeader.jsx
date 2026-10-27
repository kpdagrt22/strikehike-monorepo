"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ModeSwitch } from "@/components/ModeSwitch";

const AUTO_COLLAPSE_MS = 30_000;
const SPRING = { type: "spring", damping: 20, stiffness: 100 };

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const collapseTimer = useRef(null);

  const armCollapse = useCallback(() => {
    window.clearTimeout(collapseTimer.current);
    collapseTimer.current = window.setTimeout(() => {
      setOpen(false);
    }, AUTO_COLLAPSE_MS);
  }, []);

  const openBubble = useCallback(() => {
    setOpen(true);
    armCollapse();
  }, [armCollapse]);

  useEffect(() => {
    if (!open) {
      window.clearTimeout(collapseTimer.current);
      return undefined;
    }

    armCollapse();
    const handleOutside = (event) => {
      if (!event.target.closest?.("#site-nav-bubble")) setOpen(false);
    };
    const handleKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handleOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.clearTimeout(collapseTimer.current);
      document.removeEventListener("pointerdown", handleOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, armCollapse]);

  const close = useCallback(() => setOpen(false), []);

  return (
    <motion.header
      layout
      transition={SPRING}
      id="site-nav-bubble"
      className="pointer-events-none fixed right-2 top-2 z-50 flex max-w-[calc(100vw-1rem)] items-center justify-end sm:right-5 sm:top-5"
      onPointerEnter={openBubble}
      onPointerMove={open ? armCollapse : undefined}
      onFocusCapture={openBubble}
      aria-label="StrikeHike navigation"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {open ? (
          <motion.div
            key="expanded"
            id="site-nav-expanded"
            layout
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING}
            className="pointer-events-auto flex max-w-[calc(100vw-1rem)] items-center gap-1 rounded-full border border-black/10 bg-white/60 p-1 pl-2 shadow-[0_18px_60px_rgba(20,18,26,0.18)] backdrop-blur-2xl dark:border-white/10 dark:bg-[#0b0b12]/70 dark:shadow-[0_18px_60px_rgba(0,0,0,0.6)] sm:gap-2 sm:pl-2.5"
          >
            <Link
              href="/"
              prefetch={false}
              onClick={close}
              aria-label="strikehike.com — home"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-1 py-1 text-[#14121a] dark:text-[#f2ede4]"
            >
              <Image
                src="/icon.png"
                alt=""
                width={32}
                height={32}
                aria-hidden="true"
                draggable={false}
                className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-black/10 shadow-[0_0_14px_rgba(216,180,122,0.2)] sm:h-8 sm:w-8 dark:ring-white/10"
              />
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.12, duration: 0.2 }}
                className="hidden items-baseline min-[460px]:flex"
              >
                <span className="text-strong font-semibold tracking-[-0.03em]">
                  strikehike
                </span>
                <span className="text-micro font-medium tracking-[0.02em] text-[#c0442f] dark:text-[#ff8b77]">
                  .com
                </span>
              </motion.span>
            </Link>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.16, duration: 0.22 }}
              className="min-w-0"
            >
              <ModeSwitch onNavigate={close} />
            </motion.div>
          </motion.div>
        ) : (
          <motion.button
            key="collapsed"
            layout
            type="button"
            initial={{ opacity: 0, scale: 0.86 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.86 }}
            transition={SPRING}
            onClick={openBubble}
            aria-label="Open StrikeHike navigation"
            aria-expanded={false}
            aria-controls="site-nav-expanded"
            className="pointer-events-auto grid h-12 w-12 place-items-center rounded-full border border-black/10 bg-white/45 text-[#14121a] shadow-[0_14px_44px_rgba(20,18,26,0.18)] backdrop-blur-2xl transition-colors hover:border-[#f05d49]/35 hover:bg-white/65 dark:border-white/10 dark:bg-black/40 dark:text-[#f2ede4] dark:shadow-[0_14px_44px_rgba(0,0,0,0.55)] dark:hover:border-[#ff8b77]/30 dark:hover:bg-black/55"
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
          </motion.button>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
