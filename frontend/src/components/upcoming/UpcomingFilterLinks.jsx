"use client";

import Link from "next/link";
import { SubscribeControl } from "@/components/upcoming/SubscribeControl";
import { FollowButton } from "@/components/retention/FollowButton";
import { themeSelected } from "@/lib/analytics/events";

/**
 * The rail's theme filter: one row per theme with its horizon count, and its
 * own calendar subscription beside it. `current` marks "all" or a theme slug.
 * Every row is a link to that theme's canonical page, as before.
 */
export function UpcomingFilterLinks({
  themes,
  current = "all",
  total = 0,
  compact = false,
  showSubscribes = true,
}) {
  const allActive = current === "all";
  const row = (active) =>
    `flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 text-left text-meta transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) ${
      active
        ? "bg-(--sh-selected) font-medium text-(--sh-text-1)"
        : "text-(--sh-text-2)"
    }`;
  const chip = (active) =>
    `inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-micro font-medium transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) ${
      active
        ? "border-(--sh-line-2) bg-(--sh-selected) text-(--sh-text-1)"
        : "border-transparent text-(--sh-text-2)"
    }`;

  if (compact) {
    return (
      <nav
        aria-label="Filter upcoming dates by theme"
        className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-upcoming-filters=""
      >
        <Link
          href="/upcoming"
          aria-current={allActive ? "page" : undefined}
          onClick={() => themeSelected("all", "on", 0)}
          className={chip(allActive)}
        >
          All
          <span className="tabular-nums text-(--sh-text-3)">{total}</span>
        </Link>
        {themes.map((theme) => {
          const active = current === theme.slug;
          return (
            <span
              key={theme.slug}
              className="inline-flex shrink-0 items-center gap-1"
            >
              <Link
                href={`/upcoming/${theme.slug}`}
                aria-current={active ? "page" : undefined}
                onClick={() => themeSelected(theme.slug, "on", 1)}
                className={chip(active)}
              >
                {theme.name}
                <span className="tabular-nums text-(--sh-text-3)">
                  {theme.available}
                </span>
              </Link>
              <FollowButton theme={theme.slug} name={theme.name} compact />
            </span>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Filter upcoming dates by theme"
      className="flex flex-col"
      data-upcoming-filters=""
    >
      <div className="flex items-center gap-1">
        <Link
          href="/upcoming"
          aria-current={allActive ? "page" : undefined}
          onClick={() => themeSelected("all", "on", 0)}
          className={row(allActive)}
        >
          <span>All</span>
          <span className="text-micro tabular-nums text-(--sh-text-3)">
            {total}
          </span>
        </Link>
        {showSubscribes ? (
          <span className="w-8 shrink-0" aria-hidden="true" />
        ) : null}
      </div>
      {themes.map((theme) => {
        const active = current === theme.slug;
        return (
          <div key={theme.slug} className="flex items-center gap-1">
            <Link
              href={`/upcoming/${theme.slug}`}
              aria-current={active ? "page" : undefined}
              onClick={() => themeSelected(theme.slug, "on", 1)}
              className={row(active)}
            >
              <span className="truncate">{theme.name}</span>
              <span className="text-micro tabular-nums text-(--sh-text-3)">
                {theme.available}
              </span>
            </Link>
            {showSubscribes ? (
              <FollowButton theme={theme.slug} name={theme.name} compact />
            ) : null}
            {showSubscribes ? (
              <span className="w-8 shrink-0">
                <SubscribeControl
                  scope={theme.slug}
                  label={`Subscribe to ${theme.name} dates`}
                  compact
                />
              </span>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
