"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChronoStore } from "@/store/chronoStore";

function tabClass(active) {
  return [
    "inline-flex h-10 items-center gap-1 rounded-full px-1.5 text-micro font-medium uppercase tracking-[0.1em] transition-colors duration-(--sh-dur-micro) sm:h-9 sm:gap-1.5 sm:px-3",
    active
      ? "bg-[#f05d49]/15 text-[#c0442f] dark:bg-[#f05d49]/20 dark:text-[#ff8b77]"
      : "text-black/60 hover:bg-black/[0.04] hover:text-black/80 focus-visible:bg-black/[0.04] focus-visible:text-black/80 dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white/80 dark:focus-visible:bg-white/[0.06] dark:focus-visible:text-white/80",
  ].join(" ");
}

// "bare" sits inside the nav pill, which already draws the glass.
const NAV_CLASS = {
  glass:
    "pointer-events-auto inline-flex items-center rounded-full border border-black/10 bg-white/35 p-0.5 shadow-[0_12px_36px_rgba(20,18,26,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-black/30 dark:shadow-[0_12px_36px_rgba(0,0,0,0.4)] sm:p-1",
  bare: "pointer-events-auto inline-flex items-center",
};

export function ModeSwitch({ onNavigate, variant = "glass" }) {
  const pathname = usePathname();
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const isRegime = pathname === "/regime" || pathname?.startsWith("/regime/");
  const isConvergence =
    pathname === "/convergence" || pathname?.startsWith("/convergence/");
  const isPatterns =
    pathname === "/patterns" || pathname?.startsWith("/patterns/");
  const dateQuery = focusedDate ? `?d=${encodeURIComponent(focusedDate)}` : "";

  return (
    <nav
      aria-label="Engine views"
      className={NAV_CLASS[variant] ?? NAV_CLASS.glass}
    >
      <Link
        href={`/${dateQuery}`}
        prefetch={false}
        onClick={onNavigate}
        aria-current={
          !isRegime && !isConvergence && !isPatterns ? "page" : undefined
        }
        className={tabClass(!isRegime && !isConvergence && !isPatterns)}
      >
        <span
          className={`hidden h-1 w-1 rounded-full sm:block ${
            !isRegime && !isConvergence && !isPatterns
              ? "bg-current"
              : "bg-black/20 dark:bg-white/20"
          }`}
          aria-hidden="true"
        />
        Orrery
      </Link>
      <Link
        href={`/regime${dateQuery}`}
        onClick={onNavigate}
        aria-current={isRegime ? "page" : undefined}
        className={tabClass(isRegime)}
      >
        <span
          className={`hidden h-1 w-1 rounded-full sm:block ${
            isRegime ? "bg-current" : "bg-black/20 dark:bg-white/20"
          }`}
          aria-hidden="true"
        />
        Regime
      </Link>
      <Link
        href={`/convergence${dateQuery}`}
        onClick={onNavigate}
        aria-current={isConvergence ? "page" : undefined}
        className={tabClass(isConvergence)}
      >
        <span
          className={`hidden h-1 w-1 rounded-full sm:block ${
            isConvergence ? "bg-current" : "bg-black/20 dark:bg-white/20"
          }`}
          aria-hidden="true"
        />
        <span className="sm:hidden">Conv.</span>
        <span className="hidden sm:inline">Convergence</span>
      </Link>
      <Link
        href={`/patterns${dateQuery}`}
        onClick={onNavigate}
        aria-current={isPatterns ? "page" : undefined}
        className={tabClass(isPatterns)}
      >
        <span
          className={`hidden h-1 w-1 rounded-full sm:block ${
            isPatterns ? "bg-current" : "bg-black/20 dark:bg-white/20"
          }`}
          aria-hidden="true"
        />
        <span className="sm:hidden">Patterns</span>
        <span className="hidden sm:inline">Study of Patterns</span>
      </Link>
    </nav>
  );
}
