// Share card for /dates/[year]/[list].
import { ogCard } from "@/app/_og/card";
import { findYearList, yearListPath } from "@/lib/events/yearLists";

export const alt = "StrikeHike official date list";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({
  params,
}: {
  params: Promise<{ year: string; list: string }>;
}) {
  const { year, list: slug } = await params;
  const list = findYearList(year, slug);
  if (!list) {
    return ogCard({
      eyebrow: "Official dates",
      title: "Date list",
      line: "A complete official date list, published by StrikeHike.",
      path: `/dates/${year}/${slug}`,
    });
  }
  return ogCard({
    eyebrow: `${list.year} · ${list.themeName}`,
    title: list.title,
    line: `${list.entries.length} dates · ${list.source.label}. Times shown in the reader's zone.`,
    path: yearListPath(list),
  });
}
