// A stable URL for a claim test's share card. Unknown ids are 404s.
import { testedCardIfFound } from "@/app/_og/cards";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ claim: string }> },
) {
  const { claim } = await params;
  const card = await testedCardIfFound(claim);
  return card ?? new Response("Not found", { status: 404 });
}
