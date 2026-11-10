// Share card for /regime: title and the latest reading.
import { ogCard } from "@/app/_og/card";
import { formatDate, formatSigned } from "@/components/regime/regimeUtils";
import { getRegimeSummary } from "@/lib/seo/data";

export const alt = "StrikeHike Regime: the −50 to +50 macro atlas";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image() {
  const summary = await getRegimeSummary().catch(() => null);
  const latest = summary?.meta?.latest_core_index;
  const line = latest
    ? `Latest reading ${formatSigned(latest.score)} · week of ${formatDate(
        latest.date,
      )} · ${summary?.crashes.length ?? 0} NBER windows.`
    : "Every NBER recession since 1854, beside the weekly Core Index.";
  return ogCard({
    eyebrow: "Regime",
    title: "The −50 to +50 macro atlas.",
    line,
    path: "/regime",
  });
}
