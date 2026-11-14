// A stable URL for a recession reference's share card.
import { recessionCard } from "@/app/_og/cards";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return recessionCard(id);
}
