import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { RoundupView } from "@/components/roundup/RoundupView";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { latestApprovedRoundup } from "@/lib/roundup/store";
import { weekLabel } from "@/lib/roundup/week";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const TITLE = "This week: macro + sky";
const DESCRIPTION =
  "The latest approved StrikeHike weekly roundup: the Regime reading and its change, the dates ahead and the sky events of the week.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} · ${SITE_NAME}` },
  description: DESCRIPTION,
  alternates: {
    canonical: "/this-week",
    types: { "application/rss+xml": "/this-week/rss.xml" },
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    alternateLocale: ["en_US"],
    siteName: SITE_NAME,
    url: urlFor("/this-week"),
    title: `${TITLE} · ${SITE_NAME}`,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: `${TITLE} · ${SITE_NAME}`, description: DESCRIPTION },
};

export default async function ThisWeekPage() {
  const roundup = await latestApprovedRoundup();
  return (
    <PageShell data-this-week="">
      {roundup ? (
        <RoundupView roundup={roundup} />
      ) : (
        <div className="max-w-[760px]">
          <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
            Weekly roundup
          </p>
          <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
            This week: macro + sky
          </h1>
          <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
            The next roundup is coming. The latest approved week will appear
            here.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-micro">
            <Link href="/regime" className="underline decoration-current/30 underline-offset-2 hover:decoration-current">
              Open the Regime chart
            </Link>
            <a href="/this-week/rss.xml" className="underline decoration-current/30 underline-offset-2 hover:decoration-current">
              RSS
            </a>
          </div>
        </div>
      )}
      {roundup ? (
        <p className="mt-8 max-w-[760px] border-t border-(--sh-line-1) pt-4 text-micro text-(--sh-text-3)">
          {weekLabel(roundup.week)} · approved roundup
        </p>
      ) : null}
      <SiteColophon current="/this-week" />
    </PageShell>
  );
}
