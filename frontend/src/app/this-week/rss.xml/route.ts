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

export async function GET() {
  const rounds = await approvedRoundups();
  const items = rounds
    .map((round) => {
      const link = `${SITE_URL}/this-week/${round.week}`;
      const description =
        round.lines?.regime ?? round.lines?.dates ?? round.lines?.sky ?? "";
      return `<item><title>${escape(weekLabel(round.week))}</title><link>${link}</link><guid>${link}</guid><pubDate>${new Date(
        round.generated_at,
      ).toUTCString()}</pubDate><description>${escape(description)}</description></item>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>StrikeHike · This week</title><link>${SITE_URL}/this-week</link><description>Approved weekly roundups: macro and sky.</description><language>en</language>${items}</channel></rss>`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
