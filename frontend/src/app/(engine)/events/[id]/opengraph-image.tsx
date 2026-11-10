// Share card for /events/[id].
import { ogCard } from "@/app/_og/card";
import { eventIdFromSlug, eventSlug } from "@/lib/events/eventId";
import { getEvent } from "@/lib/seo/data";

export const alt = "StrikeHike event date";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: slug } = await params;
  const id = eventIdFromSlug(slug);
  const event = id ? await getEvent(id).catch(() => null) : null;
  if (!event) {
    return ogCard({
      eyebrow: "Upcoming dates",
      title: "Event date",
      line: "A dated event listed by StrikeHike.",
      path: `/events/${slug}`,
    });
  }
  const path = `/events/${eventSlug(event.event_id)}`;
  const time =
    event.all_day || !event.start_time
      ? "All day"
      : `${event.start_time.slice(0, 5)} ${event.timezone ?? "UTC"}`;
  return ogCard({
    eyebrow: event.theme,
    title: event.name.length > 64 ? `${event.name.slice(0, 63)}…` : event.name,
    line: `${DATE.format(new Date(`${event.start_date}T00:00:00Z`))} · ${time} · listed by StrikeHike.`,
    path,
  });
}
