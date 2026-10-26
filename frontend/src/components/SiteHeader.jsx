"use client";

import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="pointer-events-none fixed left-2 top-3 z-40 sm:left-5 sm:top-5">
      <Link
        href="/"
        aria-label="strikehike.com — home"
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-transparent px-0 py-1.5 text-[#14121a] transition-colors sm:gap-2.5 sm:border-black/10 sm:bg-white/35 sm:px-3.5 sm:py-2 sm:shadow-[0_12px_36px_rgba(20,18,26,0.10)] sm:backdrop-blur-xl sm:hover:border-[#f05d49]/30 dark:text-[#f2ede4] dark:sm:border-white/10 dark:sm:bg-black/30 dark:sm:shadow-[0_12px_36px_rgba(0,0,0,0.4)]"
      >
        <span
          aria-hidden="true"
          className="relative grid h-5 w-5 shrink-0 place-items-center rounded-full border border-black/15 bg-white/40 text-[12px] leading-none text-[#8f6b3f] shadow-[0_0_14px_rgba(216,180,122,0.2)] sm:h-6 sm:w-6 sm:text-[14px] dark:border-white/15 dark:bg-white/[0.06] dark:text-[#e6d3a1]"
          style={{
            fontFamily:
              "'Apple Symbols', 'Segoe UI Symbol', 'Noto Sans Symbols 2', serif",
          }}
        >
          ♃
          <span className="absolute -bottom-0.5 -right-0.5 h-1 w-1 rounded-full bg-[#f05d49] shadow-[0_0_6px_rgba(240,93,73,0.8)]" />
        </span>

        <span className="flex items-baseline">
          <span className="text-[11px] font-semibold tracking-[-0.03em] sm:text-strong">
            strikehike
          </span>
          <span className="text-[9px] font-medium tracking-[0.02em] text-[#c0442f] sm:text-micro dark:text-[#ff8b77]">
            .com
          </span>
        </span>
      </Link>
    </header>
  );
}
