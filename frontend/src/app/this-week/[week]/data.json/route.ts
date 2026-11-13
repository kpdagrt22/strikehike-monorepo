import { approvedRoundup } from "@/lib/roundup/store";
import { isIsoWeek } from "@/lib/roundup/week";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ week: string }> };

// Read-only source for the digest sender. The store already filters to
// approved weeks, so an unpublished or unknown week is a 404 here too.
export async function GET(_request: Request, { params }: Params) {
  const { week } = await params;
  if (!isIsoWeek(week)) {
    return Response.json(
      { detail: "No approved roundup for this week" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  const roundup = await approvedRoundup(week).catch(() => null);
  if (!roundup) {
    return Response.json(
      { detail: "No approved roundup for this week" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(roundup, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
