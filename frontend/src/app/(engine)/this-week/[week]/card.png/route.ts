// A stable URL for the week's share card. The opengraph-image route Next
// generates carries a build hash, so JSON-LD points here instead.
import { weekCard } from "@/app/_og/cards";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ week: string }> },
) {
  const { week } = await params;
  return weekCard(week);
}
