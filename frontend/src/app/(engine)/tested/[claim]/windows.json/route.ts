import { CLAIM_IDS, readClaimTest, windowsForClaim } from "@/lib/tested/store";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return CLAIM_IDS.map((claim) => ({ claim }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ claim: string }> },
) {
  const { claim: id } = await params;
  const payload = windowsForClaim(await readClaimTest(id));
  // An unpublished claim has no public test page, so it has no window list.
  if (!payload) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // The file is regenerated when content/tested changes; an hour is enough,
      // and a day of stale-while-revalidate covers a redeploy.
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
