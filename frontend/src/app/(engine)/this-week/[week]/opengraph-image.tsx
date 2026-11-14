// Share card for one approved week.
import { weekCard } from "@/app/_og/cards";

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
  return weekCard(week);
}
