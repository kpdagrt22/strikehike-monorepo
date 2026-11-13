import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { RoundupLayout } from "@/components/roundup/RoundupLayout";
import { RoundupView } from "@/components/roundup/RoundupView";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { ledgerForWeek } from "@/lib/ledger/store";
import { approvedRoundup } from "@/lib/roundup/store";
import { weekLabel } from "@/lib/roundup/week";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ week: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { week } = await params;
  const roundup = await approvedRoundup(week);
  if (!roundup) {
    return { title: "Roundup not found", robots: { index: false, follow: true } };
  }
  const title = `${weekLabel(week)} · This week · ${SITE_NAME}`;
  const description = `The approved StrikeHike roundup for ${weekLabel(week)}: the Regime reading, dates ahead and sky events.`;
  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical: `/this-week/${week}`,
      types: { "application/rss+xml": "/this-week/rss.xml" },
    },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      locale: "en_IN",
      alternateLocale: ["en_US"],
      siteName: SITE_NAME,
      url: urlFor(`/this-week/${week}`),
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function WeekPage({ params }: Params) {
  const { week } = await params;
  const roundup = await approvedRoundup(week);
  if (!roundup) notFound();
  const ledger = await ledgerForWeek(week).catch(() => null);
  return (
    <PageShell>
      <RoundupLayout ledger={ledger} surface="this_week">
        <RoundupView roundup={roundup!} />
      </RoundupLayout>
      <SiteColophon current="/this-week" />
    </PageShell>
  );
}
