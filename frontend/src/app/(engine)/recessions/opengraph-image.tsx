// Share card for /recessions.
import { ogCard } from "@/app/_og/card";
import { recessionsComplete } from "@/lib/reference/reference";
import { getRegimeAtlas } from "@/lib/seo/data";

export const alt = "StrikeHike NBER recession reference";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image() {
  const atlas = await getRegimeAtlas().catch(() => null);
  const complete = recessionsComplete(atlas);
  return ogCard({
    eyebrow: "Reference",
    title: "NBER recessions",
    line: complete
      ? `${atlas!.crashes.length} windows since 1854, with dates, length, measured S&P fall and Core Index low.`
      : "Every NBER recession in the macro atlas.",
    path: "/recessions",
  });
}
