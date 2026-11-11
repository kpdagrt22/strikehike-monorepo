// Share card for one approved week.
import { ogCard } from "@/app/_og/card";
import { approvedRoundup } from "@/lib/roundup/store";
import { weekLabel } from "@/lib/roundup/week";

export const alt = "StrikeHike weekly roundup: macro and sky";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({
  params,
}: {
  params: Promise<{ week: string }>;
}) {
  const { week } = await params;
  const roundup = await approvedRoundup(week).catch(() => null);
  return ogCard({
    eyebrow: "Weekly roundup",
    title: "This week: macro + sky",
    line: roundup
      ? `${weekLabel(week)}: the Regime reading, the dates ahead and the sky events.`
      : "An approved StrikeHike weekly roundup.",
    path: `/this-week/${week}`,
  });
}
