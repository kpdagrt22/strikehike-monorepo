import { readLedger } from "@/lib/ledger/store";
import { approvedRoundups } from "@/lib/roundup/store";
import { weekLabel } from "@/lib/roundup/week";
import { SITE_URL } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// Typographic minus for signed numbers; dates keep their hyphens.
const minus = (value: string) => value.replace(/(?<![\w])-(?=\d)/g, "\u2212");

export async function GET() {
  const [rounds, ledger] = await Promise.all([
    approvedRoundups(),
    readLedger().catch(() => []),
  ]);
  const latestByWeek = new Map<string, string>();
  for (const entry of ledger) {
    if (entry.kind === "roundup") latestByWeek.set(entry.week, entry.published_at);
  }
  const items = rounds
    .map((round) => {
      const link = `${SITE_URL}/this-week/${round.week}`;
      const description = [
        round.lines?.regime,
        round.lines?.sky,
        round.lines?.activity,
      ]
        .filter(Boolean)
        .join(" ");
      const sentences =
        description.split(/(?<=[.!?])\s+/).filter(Boolean).length;
      const body =
        sentences >= 2
          ? description
          : [description, `The approved weekly roundup for ${weekLabel(round.week)}.`]
              .filter(Boolean)
              .join(" ");
      const publishedAt = latestByWeek.get(round.week) ?? round.generated_at;
      return `<item><title>${escape(weekLabel(round.week))}</title><link>${link}</link><guid>${link}</guid><pubDate>${new Date(
        publishedAt,
      ).toUTCString()}</pubDate><description>${escape(
        minus(
          body ||
            "The approved weekly roundup: the Regime reading, the dates ahead and the sky events.",
        ),
      )}</description></item>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>StrikeHike — This week</title><link>${SITE_URL}/this-week</link><atom:link href="${SITE_URL}/this-week/rss.xml" rel="self" type="application/rss+xml"/><description>Approved weekly roundups: macro and sky.</description><language>en</language>${items}</channel></rss>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
