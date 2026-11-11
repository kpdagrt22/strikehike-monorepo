// Share card for /tested/[claim].
import { ogCard } from "@/app/_og/card";
import { readClaimTest } from "@/lib/tested/store";

export const alt = "StrikeHike claim test";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({
  params,
}: {
  params: Promise<{ claim: string }>;
}) {
  const { claim: id } = await params;
  const claim = await readClaimTest(id);
  if (!claim) {
    return ogCard({
      eyebrow: "Tested",
      title: "Claim test",
      line: "A popular sky claim, measured against the daily S&P 500 record.",
      path: `/tested/${id}`,
    });
  }
  return ogCard({
    eyebrow: "Tested",
    title: claim.title.length > 64 ? `${claim.title.slice(0, 63)}...` : claim.title,
    line: `${claim.claim} ${claim.result}`,
    path: `/tested/${claim.id}`,
  });
}
