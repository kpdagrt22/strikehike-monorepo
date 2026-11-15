// Hosted sky-activity strip for the weekly email.
import { activityChart } from "@/app/_og/email-charts";
import { approvedRoundup } from "@/lib/roundup/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ week: string }> },
) {
  const { week } = await params;
  const roundup = await approvedRoundup(week).catch(() => null);
  const chart = roundup ? activityChart(roundup) : null;
  return chart ?? new Response("Not found", { status: 404 });
}
