// Stable share-card renderers. The opengraph-image files use these, and so do
// the `card.png` routes that JSON-LD points at: Next's own opengraph-image URL
// carries a build hash, which is not a stable value to publish in structured data.
import {
  formatDate,
  formatPercent,
  formatSigned,
} from "@/components/regime/regimeUtils";
import {
  declinePath,
  declinesComplete,
  findDecline,
  findRecession,
  recessionFacts,
  recessionPath,
  recessionsComplete,
  trendRecord,
} from "@/lib/reference/reference";
import { approvedRoundup } from "@/lib/roundup/store";
import { weekLabel } from "@/lib/roundup/week";
import { getRegimeAtlas } from "@/lib/seo/data";
import { readClaimTest } from "@/lib/tested/store";
import { ogCard } from "./card";

function signed(value: number) {
  const text = Math.abs(value).toFixed(1);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

export async function weekCard(week: string) {
  const roundup = await approvedRoundup(week).catch(() => null);
  const v2 = roundup?.schema === 2;
  const skyCount = roundup?.sky_week_items?.length ?? 0;
  return ogCard({
    eyebrow: "Weekly roundup",
    title: "This week: macro + sky",
    line:
      v2 && roundup?.regime
        ? `${weekLabel(week)} · Core Index ${signed(roundup.regime.score)} (${roundup.regime.label}) · ${skyCount} sky ${skyCount === 1 ? "event" : "events"}.`
        : roundup
          ? `${weekLabel(week)}: the Regime reading, the dates ahead and the sky events.`
          : "An approved StrikeHike weekly roundup.",
    path: `/this-week/${week}`,
  });
}

export async function testedCard(id: string) {
  const claim = await readClaimTest(id);
  if (!claim) {
    return ogCard({
      eyebrow: "Tested",
      title: "Claim test",
      line: "A popular sky claim, measured against the daily S&P 500 record.",
      path: `/tested/${id}`,
    });
  }
  return ogCard({
    eyebrow: "Tested",
    title: claim.title.length > 64 ? `${claim.title.slice(0, 63)}...` : claim.title,
    line: `${claim.claim} ${claim.result}`,
    path: `/tested/${claim.id}`,
  });
}

export async function recessionCard(id: string) {
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

export async function declineCard(id: string) {
  const atlas = await getRegimeAtlas().catch(() => null);
  const record = trendRecord(atlas?.meta);
  const fall = declinesComplete(atlas?.meta) ? findDecline(atlas?.meta, id) : null;
  if (!fall || !record) {
    return ogCard({
      eyebrow: "20% S&P falls",
      title: "Decline reference",
      line: "Every 20% S&P fall since 1928, with the trend warning's record.",
      path: `/declines/${id}`,
    });
  }
  return ogCard({
    eyebrow: "S&P fall",
    title: fall.name.length > 64 ? `${fall.name.slice(0, 63)}…` : fall.name,
    line: `${formatDate(fall.peak)} → ${formatDate(fall.low)} · S&P fall ${formatPercent(
      -fall.size * 100,
      0,
    )} · warning ${fall.within_first_20pct ? "before" : "after"} the first 20%.`,
    path: declinePath(fall.id),
  });
}

/** Strict variants for the stable `card.png` routes: no record means 404. */
export async function weekCardIfApproved(week: string) {
  const roundup = await approvedRoundup(week).catch(() => null);
  return roundup ? weekCard(week) : null;
}

export async function testedCardIfFound(id: string) {
  const claim = await readClaimTest(id).catch(() => null);
  return claim ? testedCard(id) : null;
}

export async function recessionCardIfFound(id: string) {
  const atlas = await getRegimeAtlas().catch(() => null);
  const crash = recessionsComplete(atlas) ? findRecession(atlas, id) : null;
  return atlas && crash ? recessionCard(id) : null;
}

export async function declineCardIfFound(id: string) {
  const atlas = await getRegimeAtlas().catch(() => null);
  const fall = declinesComplete(atlas?.meta) ? findDecline(atlas?.meta, id) : null;
  return fall ? declineCard(id) : null;
}
