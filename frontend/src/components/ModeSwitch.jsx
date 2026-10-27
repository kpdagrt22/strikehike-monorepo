"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChronoStore } from "@/store/chronoStore";

function tabClass(active) {
  return [
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] transition-colors duration-200 sm:px-3 sm:text-micro",
    active
      ? "bg-[#f05d49]/15 text-[#c0442f] dark:bg-[#f05d49]/20 dark:text-[#ff8b77]"
      : "text-black/50 hover:bg-black/[0.04] hover:text-black/75 dark:text-white/50 dark:hover:bg-white/[0.06] dark:hover:text-white/75",
  ].join(" ");
}

export function ModeSwitch() {
  const pathname = usePathname();
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const isRegime = pathname === "/regime" || pathname?.startsWith("/regime/");
  const isConvergence =
    pathname === "/convergence" || pathname?.startsWith("/convergence/");
  const dateQuery = focusedDate ? `?d=${encodeURIComponent(focusedDate)}` : "";

  return (
    <nav
      aria-label="Engine views"
      className="pointer-events-auto inline-flex items-center rounded-full border border-black/10 bg-white/35 p-0.5 shadow-[0_12px_36px_rgba(20,18,26,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-black/30 dark:shadow-[0_12px_36px_rgba(0,0,0,0.4)] sm:p-1"
    >
      <Link
        href={`/${dateQuery}`}
        prefetch={false}
        aria-current={!isRegime && !isConvergence ? "page" : undefined}
        className={tabClass(!isRegime && !isConvergence)}
      >
        <span
          className={`h-1 w-1 rounded-full ${
            !isRegime && !isConvergence
              ? "bg-current"
              : "bg-black/20 dark:bg-white/20"
          }`}
          aria-hidden="true"
        />
        Orrery
      </Link>
      <Link
        href={`/regime${dateQuery}`}
        aria-current={isRegime ? "page" : undefined}
        className={tabClass(isRegime)}
      >
        <span
          className={`h-1 w-1 rounded-full ${
            isRegime ? "bg-current" : "bg-black/20 dark:bg-white/20"
          }`}
          aria-hidden="true"
        />
        Regime
      </Link>
      <Link
        href={`/convergence${dateQuery}`}
        aria-current={isConvergence ? "page" : undefined}
        className={tabClass(isConvergence)}
      >
        <span
          className={`h-1 w-1 rounded-full ${
            isConvergence ? "bg-current" : "bg-black/20 dark:bg-white/20"
          }`}
          aria-hidden="true"
        />
        Convergence
      </Link>
    </nav>
  );
}
