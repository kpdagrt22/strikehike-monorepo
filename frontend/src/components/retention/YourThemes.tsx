"use client";

import Link from "next/link";
import { useFollowed } from "@/hooks/useRetention";
import { clearFollowed } from "@/lib/retention/storage";

export type YourTheme = {
  id: string;
  name: string;
  count: number;
  next: Array<{ id: string; name: string; date: string }>;
};

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

// Rendered only after hydration: the server HTML has no followed group. The
// page puts it at the top of the list; when it is below the first fold there is
// nothing above it to move.
export function YourThemes({ themes }: { themes: YourTheme[] }) {
  const followed = useFollowed();
  const chosen = themes.filter((theme) => followed.includes(theme.id));
  if (followed.length === 0) return null;

  return (
    <section
      data-your-themes=""
      aria-labelledby="your-themes-heading"
      className="rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="your-themes-heading"
          className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)"
        >
          Your themes
        </h2>
        <button
          type="button"
          data-clear-followed=""
          onClick={() => clearFollowed()}
          className="inline-flex min-h-9 items-center rounded-full px-2 text-micro font-medium text-(--sh-text-2) underline decoration-current/30 underline-offset-2 transition-colors hover:text-(--sh-text-1) hover:decoration-current focus-visible:text-(--sh-text-1) focus-visible:decoration-current pointer-coarse:min-h-11"
        >
          Clear
        </button>
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {chosen.length === 0 ? (
          <li className="text-meta text-(--sh-text-2)">
            No dates in the next 12 months for your themes.
          </li>
        ) : null}
        {chosen.map((theme) => (
          <li key={theme.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <Link
              href={`/upcoming/${theme.id}`}
              className="text-meta font-medium text-(--sh-text-1) underline decoration-transparent underline-offset-2 hover:decoration-current"
            >
              {theme.name}
            </Link>
            <span className="text-micro tabular-nums text-(--sh-text-3)">
              {theme.count} {theme.count === 1 ? "date" : "dates"}
            </span>
            {theme.next.length > 0 ? (
              <span className="text-micro text-(--sh-text-3)">
                next{" "}
                {theme.next.map((event, index) => (
                  <span key={event.id}>
                    {index > 0 ? ", " : ""}
                    <Link
                      href={`/events/${event.id.replaceAll(":", "~")}`}
                      className="underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
                    >
                      {event.name}
                    </Link>{" "}
                    <span className="whitespace-nowrap tabular-nums">
                      {SHORT_DATE.format(new Date(`${event.date}T00:00:00Z`))}
                    </span>
                  </span>
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
