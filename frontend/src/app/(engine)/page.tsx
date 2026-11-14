import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { flatEvents } from "@/components/upcoming/upcomingGrouping";
import { latestApprovedRoundup } from "@/lib/roundup/store";
import { weekLabel } from "@/lib/roundup/week";
import { getRegimeSummary, getUpcoming } from "@/lib/seo/data";
import { homeGraph } from "@/lib/seo/graphs";
import { pageMetadata } from "@/lib/seo/site";
import { orderedThemes } from "@/lib/events/upcoming";
import HomeClient from "./HomeClient";

// The orrery is a client view; this server wrapper adds the home page's own
// metadata, its JSON-LD, and the "At a glance" snapshot. The snapshot is read
// per request so the server HTML carries the latest week, the next three dates
// and the current Core Index even when the client HUD is still loading.
export const metadata: Metadata = pageMetadata("/");
export const dynamic = "force-dynamic";

export default async function Page() {
  const [latest, summary, upcoming] = await Promise.all([
    latestApprovedRoundup().catch(() => null),
    getRegimeSummary().catch(() => null),
    getUpcoming().catch(() => null),
  ]);
  const next = flatEvents(orderedThemes(upcoming)).slice(0, 3) as Array<{
    event: {
      name: string;
      start_date: string;
      start_time: string | null;
      all_day: boolean;
    };
    theme: { name: string };
  }>;
  const reading = summary?.meta?.latest_core_index ?? null;
  const snapshot = {
    week: latest?.week ?? null,
    weekLabel: latest ? weekLabel(latest.week) : null,
    regimeLine: latest?.lines?.regime ?? null,
    core:
      reading && reading.score != null
        ? {
            score: reading.score,
            bucket: reading.bucket?.replaceAll("_", " ") ?? null,
            date: reading.date,
          }
        : null,
    next: next.map(({ event, theme }) => ({
      name: event.name,
      date: event.start_date,
      time: event.start_time,
      allDay: event.all_day,
      theme: theme.name,
    })),
  };

  return (
    <>
      <HomeClient snapshot={snapshot} />
      <JsonLd data={homeGraph(latest?.generated_at)} />
    </>
  );
}
