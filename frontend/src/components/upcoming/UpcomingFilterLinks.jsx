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

export function UpcomingFilterLinks({ themes, selected }) {
  const allActive = selected.length === 0;
  return (
    <nav
      aria-label="Filter upcoming dates by theme"
      className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Link
        href="/upcoming"
        aria-current={allActive ? "true" : undefined}
        onClick={() => themeSelected("all", "on", 0)}
        className={chipClass(allActive)}
      >
        All
      </Link>
      {themes.map((theme) => {
        const active = selected.includes(theme.slug);
        return (
          <Link
            key={theme.slug}
            href={`/upcoming?themes=${theme.slug}`}
            aria-current={active ? "true" : undefined}
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
