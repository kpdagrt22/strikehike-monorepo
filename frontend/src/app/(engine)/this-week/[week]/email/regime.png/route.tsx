// Hosted regime sparkline for the weekly email.
import { regimeChart } from "@/app/_og/email-charts";
import { approvedRoundup } from "@/lib/roundup/store";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ week: string }> },
) {
  const { week } = await params;
  const roundup = await approvedRoundup(week).catch(() => null);
  const chart = roundup ? regimeChart(roundup) : null;
  return chart ?? new Response("Not found", { status: 404 });
}
