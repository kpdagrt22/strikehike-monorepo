import Link from "next/link";
import { EventSourceLink } from "@/components/upcoming/EventSourceLink";
import { EventActionLinks } from "@/components/upcoming/EventActionLinks";
import { LocalDateTime } from "@/components/upcoming/LocalDateTime";
import { eventPath } from "@/lib/events/eventId";
import { statusLabel } from "@/lib/events/upcoming";
import type { UpcomingEventPayload } from "@/lib/seo/data";

// One dated row, shared by the Upcoming pages and the event page's related
// column: a fixed 96 px date, the title on line 1, and the theme, local time
// and source on line 2. The three actions stay available, revealed on hover or
// focus on pointer devices (absolutely, so they add no row height); on touch
// they sit under the second line, always visible. The classes (.sh-row-*) are in
// globals.css: a row repeats in both the HTML and the RSC payload (S3.2).
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
      className="inline-flex min-h-6 items-center underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:decoration-current"
    >
      {event.name}
    </Link>
  ) : (
    event.name
  );

  return (
    <li
      data-upcoming-row=""
      className="group sh-row"
    >
      <div className="sh-row-body">
        <span className="sh-row-date">
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
          <p className="sh-row-title" title={event.name}>
            {title}
          </p>
          <div className="sh-row-meta">
            {themeName ? (
              <>
                <Link
                  href={`/upcoming/${themeSlug}`}
                  className="sh-row-theme"
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
            <EventActionLinks
              event={{
                event_id: event.event_id,
                start_date: event.start_date,
                start_utc: event.start_utc,
                all_day: event.all_day,
                status: event.status,
              }}
              themeSlug={themeSlug}
              className="sh-row-actions-float"
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}
