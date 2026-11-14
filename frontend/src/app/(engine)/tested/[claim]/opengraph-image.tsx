// Share card for /tested/[claim].
import { testedCard } from "@/app/_og/cards";

export const alt = "StrikeHike claim test";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({
  params,
}: {
  params: Promise<{ claim: string }>;
}) {
  const { claim } = await params;
  return testedCard(claim);
}
