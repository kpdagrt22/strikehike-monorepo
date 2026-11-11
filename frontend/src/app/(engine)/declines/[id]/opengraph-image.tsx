// Share card for /declines/[id].
import { ogCard } from "@/app/_og/card";
import { formatDate, formatPercent } from "@/components/regime/regimeUtils";
import {
  declinePath,
  declinesComplete,
  findDecline,
  trendRecord,
} from "@/lib/reference/reference";
import { getRegimeAtlas } from "@/lib/seo/data";

export const alt = "StrikeHike 20% S&P fall reference";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const atlas = await getRegimeAtlas().catch(() => null);
  const record = trendRecord(atlas?.meta);
  const fall = declinesComplete(atlas?.meta) ? findDecline(atlas?.meta, id) : null;
  if (!fall || !record) {
    return ogCard({
      eyebrow: "20% S&P falls",
      title: "Decline reference",
      line: "Every 20% S&P fall since 1928, with the trend warning's record.",
      path: `/declines/${id}`,
    });
  }
  return ogCard({
    eyebrow: "S&P fall",
    title: fall.name.length > 64 ? `${fall.name.slice(0, 63)}…` : fall.name,
    line: `${formatDate(fall.peak)} → ${formatDate(fall.low)} · S&P fall ${formatPercent(
      -fall.size * 100,
      0,
    )} · warning ${fall.within_first_20pct ? "before" : "after"} the first 20%.`,
    path: declinePath(fall.id),
  });
}
