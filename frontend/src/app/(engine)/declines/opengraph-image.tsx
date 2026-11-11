// Share card for /declines.
import { ogCard } from "@/app/_og/card";
import { declinesComplete, trendRecord } from "@/lib/reference/reference";
import { getRegimeAtlas } from "@/lib/seo/data";

export const alt = "StrikeHike 20% S&P fall reference";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image() {
  const atlas = await getRegimeAtlas().catch(() => null);
  const record = trendRecord(atlas?.meta);
  return ogCard({
    eyebrow: "Reference",
    title: "20% S&P falls",
    line: declinesComplete(atlas?.meta)
      ? `${record!.falls.length} falls since 1928, with the trend warning's first-20% record, misses included.`
      : "Every 20% S&P fall since 1928, as Method & record lists it.",
    path: "/declines",
  });
}
