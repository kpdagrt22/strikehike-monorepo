// Share card for /this-week: the latest approved roundup.
import { ogCard } from "@/app/_og/card";
import { latestApprovedRoundup } from "@/lib/roundup/store";
import { weekLabel } from "@/lib/roundup/week";

export const alt = "StrikeHike weekly roundup: macro and sky";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image() {
  const roundup = await latestApprovedRoundup().catch(() => null);
  return ogCard({
    eyebrow: "Weekly roundup",
    title: "This week: macro + sky",
    line: roundup
      ? `${weekLabel(roundup.week)}: the Regime reading, the dates ahead and the sky events.`
      : "The latest approved week: the Regime reading, the dates ahead and the sky events.",
    path: "/this-week",
  });
}
