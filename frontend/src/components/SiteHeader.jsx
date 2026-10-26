"use client";

import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="pointer-events-none fixed left-3 top-3 z-40 sm:left-5 sm:top-5">
      <Link
        href="/"
        aria-label="strikehike.com — home"
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-transparent px-0 py-1.5 text-[#14121a] transition-colors sm:gap-2.5 sm:border-black/10 sm:bg-white/35 sm:px-3.5 sm:py-2 sm:shadow-[0_12px_36px_rgba(20,18,26,0.10)] sm:backdrop-blur-xl sm:hover:border-[#f05d49]/30 dark:text-[#f2ede4] dark:sm:border-white/10 dark:sm:bg-black/30 dark:sm:shadow-[0_12px_36px_rgba(0,0,0,0.4)]"
      >
        <span className="relative hidden h-6 w-6 place-items-center sm:grid">
          <span className="absolute inset-0 rounded-full border border-current opacity-25" />
          <span className="absolute h-3.5 w-3.5 rounded-full border border-[#f05d49]/60" />
          <span className="h-1 w-1 rounded-full bg-[#f05d49] shadow-[0_0_8px_rgba(240,93,73,0.8)]" />
        </span>

        <span className="flex items-baseline">
          <span className="text-[12px] font-semibold tracking-[-0.03em] sm:text-strong">
            strikehike
          </span>
          <span className="text-[10px] font-medium tracking-[0.02em] text-[#c0442f] sm:text-micro dark:text-[#ff8b77]">
            .com
          </span>
        </span>
      </Link>
    </header>
  );
}
