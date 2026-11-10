// Share card for /upcoming. Built per request from the same payload the page reads.
import { ogCard } from "@/app/_og/card";
import { flatEvents } from "@/components/upcoming/upcomingGrouping";
import { orderedThemes } from "@/lib/events/upcoming";
import { getUpcoming } from "@/lib/seo/data";

export const alt = "StrikeHike Upcoming dates: the next 12 months of official dates";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export default async function Image() {
  const payload = await getUpcoming().catch(() => null);
  const themes = orderedThemes(payload);
  const items = flatEvents(themes);
  const next = items[0];
  const count = themes.reduce((sum, theme) => sum + theme.available, 0);
  const line = next
    ? `${count} dates in the next 12 months. Next: ${next.event.name} on ${DATE.format(
        new Date(`${next.event.start_date}T00:00:00Z`),
      )}.`
    : "Scheduled releases, central-bank decisions, eclipses and festivals for the next 12 months.";
  return ogCard({
    eyebrow: "Upcoming dates",
    title: next ? "The next dated items" : "Upcoming dates",
    line,
    path: "/upcoming",
  });
}
