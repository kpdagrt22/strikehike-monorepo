// A stable URL for a decline reference's share card. Unknown ids are 404s.
import { declineCardIfFound } from "@/app/_og/cards";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const card = await declineCardIfFound(id);
  return card ?? new Response("Not found", { status: 404 });
}
