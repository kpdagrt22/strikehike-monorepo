// A stable URL for the week's share card. The opengraph-image route Next
// generates carries a build hash, so JSON-LD points here instead. Unknown or
// unapproved weeks are 404s, never a generic card.
import { weekCardIfApproved } from "@/app/_og/cards";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ week: string }> },
) {
  const { week } = await params;
  const card = await weekCardIfApproved(week);
  return card ?? new Response("Not found", { status: 404 });
}
