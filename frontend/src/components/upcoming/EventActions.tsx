"use client";

import Link from "next/link";
import { calendarSubscribed, dateTravelled } from "@/lib/analytics/events";
import { eventCalendarPath, eventPath, skyDate, skyHref } from "@/lib/events/eventId";
import { useChronoStore } from "@/store/chronoStore";

// The three quiet actions beside a dated row. Desktop reveals them on row hover
// or focus-within (the row carries `group`); on touch they are always visible.
// Every target is at least 44 px tall on touch and keeps the site's focus ring.
const ACTION =
  "inline-flex min-h-11 items-center rounded-full border border-(--sh-line-1) px-2.5 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) focus-visible:text-(--sh-text-1) sm:min-h-8";
const REVEAL =
  "pointer-fine:opacity-0 pointer-fine:transition-opacity pointer-fine:duration-(--sh-dur-reveal) pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 motion-reduce:transition-none";

const SCOPES: Record<string, "all" | "science" | "finance" | "culture-religion"> = {
  all: "all",
  science: "science",
  finance: "finance",
  "culture-religion": "culture-religion",
};

type ActionEvent = {
  event_id: string;
  start_date: string;
  start_utc?: string | null;
  all_day?: boolean;
  status?: string;
};

/**
 * "See the sky", "Event page" and "Add to calendar" for one event.
 *
 * On /upcoming and /upcoming/[theme] "See the sky" is a link to /?d=…: it fires
 * date_travelled("archive_event") and sets the focused date before navigating,
 * so the home page does not count the same journey again as a deep_link.
 * On the home page pass `onSeeSky`: there the orrery is already on screen, so
 * the caller travels in place and closes its sheet.
 */
export function EventActions({
  event,
  themeSlug,
  onSeeSky,
  className = "",
}: {
  event: ActionEvent;
  themeSlug: string;
  onSeeSky?: (date: string) => void;
  className?: string;
}) {
  const sky = skyHref(event);
  const date = skyDate(event);
  const scope = SCOPES[themeSlug] ?? null;
  const past = event.status === "completed" || event.status === "cancelled";

  return (
    <div
      data-event-actions
      className={`flex flex-wrap items-center gap-1.5 ${REVEAL} ${className}`}
    >
      {sky ? (
        onSeeSky ? (
          <button type="button" className={ACTION} onClick={() => onSeeSky(date)}>
            See the sky
          </button>
        ) : (
          <Link
            href={sky}
            className={ACTION}
            onClick={() => {
              dateTravelled("archive_event", date);
              useChronoStore.getState().setFocusedDate(date);
            }}
          >
            See the sky
          </Link>
        )
      ) : null}
      <Link href={eventPath(event.event_id)} className={ACTION}>
        Event page
      </Link>
      {scope && !past ? (
        <a
          href={eventCalendarPath(event.event_id)}
          className={ACTION}
          onClick={() => calendarSubscribed(scope, "download")}
        >
          Add to calendar
        </a>
      ) : null}
    </div>
  );
}
