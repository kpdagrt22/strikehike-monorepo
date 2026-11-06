"use client";

import Link from "next/link";
import { themeSelected } from "@/lib/analytics/events";

const CHIP =
  "inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 text-micro font-medium transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover)";

function chipClass(active) {
  return `${CHIP} ${
    active
      ? "border-(--sh-line-2) bg-(--sh-selected) text-(--sh-text-1)"
      : "border-transparent text-(--sh-text-2)"
  }`;
}

/**
 * One link per theme, to that theme's own page (/upcoming/[theme]) so every
 * filter has a canonical URL. `current` marks the active one ("all" or a slug).
 */
export function UpcomingFilterLinks({ themes, current = "all" }) {
  const allActive = current === "all";
  return (
    <nav
      aria-label="Filter upcoming dates by theme"
      className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Link
        href="/upcoming"
        aria-current={allActive ? "page" : undefined}
        onClick={() => themeSelected("all", "on", 0)}
        className={chipClass(allActive)}
      >
        All
      </Link>
      {themes.map((theme) => {
        const active = current === theme.slug;
        return (
          <Link
            key={theme.slug}
            href={`/upcoming/${theme.slug}`}
            aria-current={active ? "page" : undefined}
            onClick={() => themeSelected(theme.slug, "on", 1)}
            className={chipClass(active)}
          >
            {theme.name}
          </Link>
        );
      })}
    </nav>
  );
}
