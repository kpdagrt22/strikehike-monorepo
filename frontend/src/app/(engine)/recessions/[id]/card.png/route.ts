// A stable URL for a recession reference's share card. Unknown ids are 404s.
import { recessionCardIfFound } from "@/app/_og/cards";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const card = await recessionCardIfFound(id);
  return card ?? new Response("Not found", { status: 404 });
}
