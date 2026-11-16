// A stable URL for a decline reference's share card. Unknown ids are 404s; a
// backend that does not answer (with no last-good atlas) is a 503.
import { declineCardIfFound } from "@/app/_og/cards";
import { isBackendUnavailable, serviceUnavailableResponse } from "@/lib/server/lastGood";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const card = await declineCardIfFound(id);
    return card ?? new Response("Not found", { status: 404 });
  } catch (error) {
    if (isBackendUnavailable(error)) return serviceUnavailableResponse();
    throw error;
  }
}
