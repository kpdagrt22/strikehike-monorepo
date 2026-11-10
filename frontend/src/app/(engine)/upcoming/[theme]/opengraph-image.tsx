// Share card for /upcoming/[theme].
import { ogCard } from "@/app/_og/card";
import { orderedThemes, themeName } from "@/lib/events/upcoming";
import { getUpcoming } from "@/lib/seo/data";

export const alt = "StrikeHike Upcoming dates for one theme";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({
  params,
}: {
  params: Promise<{ theme: string }>;
}) {
  const { theme } = await params;
  const payload = await getUpcoming().catch(() => null);
  const entry = orderedThemes(payload).find((item) => item.slug === theme);
  const name = themeName(theme) ?? "Theme";
  const count = entry?.available ?? 0;
  return ogCard({
    eyebrow: "Upcoming dates",
    title: `${name} dates`,
    line: count
      ? `${count} dates in the next 12 months, with times from the official calendars.`
      : "Dates from the official calendars, listed with local times.",
    path: `/upcoming/${theme}`,
  });
}
