// Share card for one approved week.
import { ogCard } from "@/app/_og/card";
import { approvedRoundup } from "@/lib/roundup/store";
import { weekLabel } from "@/lib/roundup/week";

export const alt = "StrikeHike weekly roundup: macro and sky";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

function signed(value: number) {
  const text = Math.abs(value).toFixed(1);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

export default async function Image({
  params,
}: {
  params: Promise<{ week: string }>;
}) {
  const { week } = await params;
  const roundup = await approvedRoundup(week).catch(() => null);
  const v2 = roundup?.schema === 2;
  const skyCount = roundup?.sky_week_items?.length ?? 0;
  return ogCard({
    eyebrow: "Weekly roundup",
    title: "This week: macro + sky",
    line: v2 && roundup?.regime
      ? `${weekLabel(week)} · Core Index ${signed(roundup.regime.score)} (${roundup.regime.label}) · ${skyCount} sky ${skyCount === 1 ? "event" : "events"}.`
      : roundup
        ? `${weekLabel(week)}: the Regime reading, the dates ahead and the sky events.`
        : "An approved StrikeHike weekly roundup.",
    path: `/this-week/${week}`,
  });
}
