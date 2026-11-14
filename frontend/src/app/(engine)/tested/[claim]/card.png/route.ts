// A stable URL for a claim test's share card.
import { testedCard } from "@/app/_og/cards";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ claim: string }> },
) {
  const { claim } = await params;
  return testedCard(claim);
}
