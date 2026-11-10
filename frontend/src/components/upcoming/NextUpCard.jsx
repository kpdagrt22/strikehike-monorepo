"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LocalDateTime } from "@/components/upcoming/LocalDateTime";
import { eventInstant } from "@/lib/events/localTime";
import { eventPath } from "@/lib/events/eventId";

// Whole local days between the event's instant and now. The label says only
// when the date is, never what it might bring.
function relativeLabel(event, now) {
  const start = event.all_day
    ? new Date(`${event.start_date}T00:00:00`)
    : new Date(
        eventInstant(event.start_date, event.start_time, event.start_utc),
      );
  if (Number.isNaN(start.getTime())) return "";
  const day = (date) =>
    Math.floor(
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() /
        86_400_000,
    );
  const days = day(start) - day(now);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `in ${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  const months = Math.round(days / 30);
  return `in ${months} ${months === 1 ? "month" : "months"}`;
}

export function NextUpCard({ item }) {
  const [relative, setRelative] = useState("");

  useEffect(() => {
    if (!item) return undefined;
    const update = () => setRelative(relativeLabel(item.event, new Date()));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [item]);

  if (!item) return null;
  const { event } = item;

  return (
    <aside
      data-next-up=""
      aria-labelledby="next-up-title"
      className="mt-5 rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-4"
    >
      <p
        id="next-up-title"
        className="text-micro font-medium uppercase tracking-[0.16em] text-(--sh-text-3)"
      >
        Next up
      </p>
      <Link
        href={eventPath(event.event_id)}
        className="mt-1.5 block text-body font-medium leading-snug text-(--sh-text-1) underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:decoration-current"
      >
        {event.name}
      </Link>
      <p className="mt-1.5 text-meta leading-relaxed text-(--sh-text-2)">
        <LocalDateTime
          startDate={event.start_date}
          startTime={event.start_time}
          startUtc={event.start_utc}
          timezone={event.timezone}
          allDay={event.all_day}
          part="date"
          long
        />
        {event.all_day ? null : (
          <>
            {" · "}
            <LocalDateTime
              startDate={event.start_date}
              startTime={event.start_time}
              startUtc={event.start_utc}
              timezone={event.timezone}
              allDay={event.all_day}
              part="time"
            />
          </>
        )}
      </p>
      <p
        data-next-up-relative=""
        className="mt-1 min-h-4 text-micro font-medium text-(--sh-signal-ink)"
      >
        {relative}
      </p>
    </aside>
  );
}
