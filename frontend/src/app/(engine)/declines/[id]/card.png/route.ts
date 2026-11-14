// A stable URL for a decline reference's share card.
import { declineCard } from "@/app/_og/cards";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return declineCard(id);
}
