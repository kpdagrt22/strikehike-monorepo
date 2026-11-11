import { latestApprovedRoundup } from "@/lib/roundup/store";

export const dynamic = "force-dynamic";

// A tiny public probe: the change note links to /this-week only when a week is
// approved, and the home page is static, so the client asks here.
export async function GET() {
  const roundup = await latestApprovedRoundup().catch(() => null);
  return Response.json(
    { week: roundup?.week ?? null },
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
