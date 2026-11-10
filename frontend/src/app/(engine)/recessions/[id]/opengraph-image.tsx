// Share card for /recessions/[id].
import { ogCard } from "@/app/_og/card";
import {
  formatDate,
  formatPercent,
  formatSigned,
} from "@/components/regime/regimeUtils";
import {
  findRecession,
  recessionFacts,
  recessionPath,
  recessionsComplete,
} from "@/lib/reference/reference";
import { getRegimeAtlas } from "@/lib/seo/data";

export const alt = "StrikeHike NBER recession reference";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const atlas = await getRegimeAtlas().catch(() => null);
  const crash = recessionsComplete(atlas) ? findRecession(atlas, id) : null;
  if (!atlas || !crash) {
    return ogCard({
      eyebrow: "NBER recessions",
      title: "Recession reference",
      line: "Every NBER recession in the macro atlas, with its measured S&P fall.",
      path: `/recessions/${id}`,
    });
  }
  const facts = recessionFacts(atlas, crash);
  const figures = [
    facts.length == null ? null : `${facts.length} days`,
    facts.drawdown == null ? null : `S&P fall ${formatPercent(facts.drawdown, 1)}`,
    facts.coreLow == null ? null : `Core Index low ${formatSigned(facts.coreLow)}`,
  ].filter(Boolean);
  return ogCard({
    eyebrow: "NBER recession",
    title: crash.name.length > 64 ? `${crash.name.slice(0, 63)}…` : crash.name,
    line: `${formatDate(crash.start)} → ${formatDate(crash.end)} · ${figures.join(" · ")}`,
    path: recessionPath(crash.id),
  });
}
