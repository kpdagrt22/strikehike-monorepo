"use client";

import Link from "next/link";
import { ModeSwitch } from "@/components/ModeSwitch";

export function SiteHeader() {
  return (
    <header className="pointer-events-none fixed left-2 top-3 z-40 flex max-w-[calc(100vw-1rem)] items-center gap-1.5 sm:left-5 sm:top-5 sm:gap-2">
      <Link
        href="/"
        aria-label="strikehike.com — home"
        className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-transparent px-0 py-1.5 text-[#14121a] transition-colors sm:gap-2.5 sm:border-black/10 sm:bg-white/35 sm:px-3.5 sm:py-2 sm:shadow-[0_12px_36px_rgba(20,18,26,0.10)] sm:backdrop-blur-xl sm:hover:border-[#f05d49]/30 dark:text-[#f2ede4] dark:sm:border-white/10 dark:sm:bg-black/30 dark:sm:shadow-[0_12px_36px_rgba(0,0,0,0.4)]"
      >
        <img
          src="/icon.png"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="h-5 w-5 shrink-0 rounded-full object-cover ring-1 ring-black/10 shadow-[0_0_14px_rgba(216,180,122,0.2)] sm:h-6 sm:w-6 dark:ring-white/10"
        />

        <span className="hidden items-baseline min-[430px]:flex">
          <span className="text-[11px] font-semibold tracking-[-0.03em] sm:text-strong">
            strikehike
          </span>
          <span className="text-[9px] font-medium tracking-[0.02em] text-[#c0442f] sm:text-micro dark:text-[#ff8b77]">
            .com
          </span>
        </span>
      </Link>

      <ModeSwitch />
    </header>
  );
}
