import Link from "next/link";
import { EventSourceLink } from "@/components/upcoming/EventSourceLink";
import { EventActions } from "@/components/upcoming/EventActions";
import { LocalDateTime } from "@/components/upcoming/LocalDateTime";
import { eventPath } from "@/lib/events/eventId";
import { statusLabel } from "@/lib/events/upcoming";
import type { UpcomingEventPayload } from "@/lib/seo/data";

// One dated row, shared by the Upcoming pages and the event page's related
// column: a fixed 96 px date, the title on line 1, and the theme, local time
// and source on line 2. The three actions stay available, revealed on hover or
// focus on pointer devices (absolutely, so they add no row height); on touch
// they sit under the second line, always visible.
export function UpcomingEventRow({
  event,
  themeSlug,
  themeName,
  actions = true,
  linkTitle = false,
}: {
  event: UpcomingEventPayload;
  themeSlug: string;
  themeName?: string;
  actions?: boolean;
  linkTitle?: boolean;
}) {
  const status = statusLabel(event.status);
  const title = linkTitle ? (
    <Link
      href={eventPath(event.event_id)}
      className="underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:decoration-current"
    >
      {event.name}
    </Link>
  ) : (
    event.name
  );

  return (
    <li
      data-upcoming-row=""
      className="group relative border-b border-(--sh-line-1) last:border-b-0"
    >
      <div className="flex min-h-16 items-start gap-3 py-2">
        <span className="w-24 shrink-0 whitespace-nowrap pt-0.5 text-micro uppercase tracking-[0.08em] text-(--sh-text-3)">
          <LocalDateTime
            startDate={event.start_date}
            startTime={event.start_time}
            startUtc={event.start_utc}
            timezone={event.timezone}
            allDay={event.all_day}
            part="date"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-body font-medium leading-snug text-(--sh-text-1)"
            title={event.name}
          >
            {title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-(--sh-text-3)">
            {themeName ? (
              <>
                <Link
                  href={`/upcoming/${themeSlug}`}
                  className="inline-flex items-center rounded-full border border-(--sh-line-1) px-1.5 py-0.5 font-medium text-(--sh-text-2) transition-colors hover:border-(--sh-line-2) hover:text-(--sh-text-1) focus-visible:border-(--sh-line-2) focus-visible:text-(--sh-text-1)"
                >
                  {themeName}
                </Link>
                <span aria-hidden="true">·</span>
              </>
            ) : null}
            <LocalDateTime
              startDate={event.start_date}
              startTime={event.start_time}
              startUtc={event.start_utc}
              timezone={event.timezone}
              allDay={event.all_day}
              part="time"
            />
            {status ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{status}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <EventSourceLink
              eventId={event.event_id}
              eventName={event.name}
              theme={themeSlug}
              daysUntil={event.days_until}
              sourceUrl={event.source_url}
              verification={event.verification}
            />
          </div>
          {actions ? (
            <EventActions
              event={event}
              themeSlug={themeSlug}
              className="mt-1.5 pointer-fine:absolute pointer-fine:right-2 pointer-fine:top-1/2 pointer-fine:z-10 pointer-fine:mt-0 pointer-fine:-translate-y-1/2 pointer-fine:rounded-full pointer-fine:bg-(--sh-surface-overlay) pointer-fine:px-1 pointer-fine:shadow-(--sh-shadow-float) pointer-fine:backdrop-blur-xl"
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}
