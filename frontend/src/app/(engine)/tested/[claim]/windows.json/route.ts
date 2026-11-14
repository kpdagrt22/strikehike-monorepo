import { readClaimTest } from "@/lib/tested/store";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return [
    "mercury-retrograde",
    "full-moon",
    "eclipses",
    "new-moon",
    "solstices-equinoxes",
    "mars-retrograde",
    "mars-saturn-conjunction",
  ].map((claim) => ({ claim }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ claim: string }> },
) {
  const { claim: id } = await params;
  const claim = await readClaimTest(id);
  if (!claim) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify({ windows: claim.windows }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
