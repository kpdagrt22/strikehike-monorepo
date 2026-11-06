import Link from "next/link";
import { EventSourceLink } from "@/components/upcoming/EventSourceLink";
import { LocalDateTime } from "@/components/upcoming/LocalDateTime";
import { statusLabel } from "@/lib/events/upcoming";
import type { UpcomingEventPayload } from "@/lib/seo/data";

// One dated row, shared by /upcoming and /upcoming/[theme]: the date, the name,
// the time, the status and the source. Part D adds the three actions beside it.
export function UpcomingEventRow({
  event,
  themeSlug,
  themeName,
}: {
  event: UpcomingEventPayload;
  themeSlug: string;
  themeName?: string;
}) {
  const status = statusLabel(event.status);
  return (
    <li className="border-b border-(--sh-line-1) py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="w-[5.25rem] shrink-0 text-micro uppercase tracking-[0.08em] text-(--sh-text-3)">
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
          <p className="text-body font-medium leading-snug text-(--sh-text-1)">
            {event.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-(--sh-text-3)">
            {themeName ? (
              <>
                <Link
                  href={`/upcoming/${themeSlug}`}
                  className="underline decoration-current/25 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current focus-visible:text-(--sh-text-1)"
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
        </div>
      </div>
    </li>
  );
}
