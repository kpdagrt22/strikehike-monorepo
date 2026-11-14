import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { RoundupLayout } from "@/components/roundup/RoundupLayout";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { approvedRoundups } from "@/lib/roundup/store";
import { weekLabel } from "@/lib/roundup/week";
import { thisWeekGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const TITLE = "This week: macro + sky";
const DESCRIPTION =
  "The latest approved StrikeHike weekly roundup, and every approved week in the archive: the Regime reading, the dates ahead and the sky events.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} — ${SITE_NAME}` },
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
    title: `${TITLE} — ${SITE_NAME}`,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: `${TITLE} — ${SITE_NAME}`, description: DESCRIPTION },
};

type Props = {
  searchParams: Promise<{ digest?: string | string[] }>;
};

export default async function ThisWeekPage({ searchParams }: Props) {
  const [rounds, params] = await Promise.all([
    approvedRoundups(),
    searchParams,
  ]);
  const latest = rounds[0] ?? null;
  const surface = params.digest === "footer" ? "footer" : "this_week";

  return (
    <PageShell data-this-week="">
      <JsonLd data={thisWeekGraph(rounds)} />
      <RoundupLayout ledger={null} surface={surface}>
        <header className="mt-4 max-w-[760px]">
          <p className="flex flex-wrap items-center gap-2 text-micro font-medium uppercase tracking-[0.2em] text-(--sh-weekly)">
            <span className="sh-weekly-dot" aria-hidden="true" />
            Weekly roundup
          </p>
          <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
            This week: macro + sky
          </h1>
          <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
            The latest approved week, then the archive. Each week keeps its own
            page and its own ledger line.
          </p>
          <p className="mt-3 text-micro text-(--sh-text-3)">
            <a
              href="/this-week/rss.xml"
              className="underline decoration-current/30 underline-offset-2 hover:decoration-current"
            >
              RSS
            </a>
            {" · "}
            <Link
              href="/ledger"
              className="underline decoration-current/30 underline-offset-2 hover:decoration-current"
            >
              Public ledger
            </Link>
          </p>
        </header>

        {latest ? (
          <section
            data-latest-roundup
            className="mt-6 max-w-[760px] rounded-2xl border border-(--sh-weekly-line) bg-(--sh-weekly-soft) p-5"
          >
            <p className="text-micro font-medium uppercase tracking-[0.16em] text-(--sh-weekly)">
              Latest
            </p>
            <p className="mt-1 text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
              <Link
                href={`/this-week/${latest.week}`}
                className="underline decoration-current/30 underline-offset-2 hover:decoration-current"
              >
                {weekLabel(latest.week)}
              </Link>
            </p>
            <p className="mt-2 text-meta leading-relaxed text-(--sh-text-2)">
              {latest.lines?.regime}
            </p>
            <Link
              href={`/this-week/${latest.week}`}
              className="mt-3 inline-flex min-h-9 items-center rounded-full bg-(--sh-weekly-fill) px-4 text-micro font-semibold text-(--sh-weekly-on-fill) transition-opacity hover:opacity-90"
            >
              Read the {latest.week} roundup
            </Link>
          </section>
        ) : (
          <p className="mt-6 max-w-[760px] text-body leading-relaxed text-(--sh-text-2)">
            The next roundup is coming. The latest approved week appears here.
          </p>
        )}

        <section
          aria-labelledby="roundup-archive-heading"
          data-roundup-archive
          className="mt-8 max-w-[760px]"
        >
          <h2
            id="roundup-archive-heading"
            className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)"
          >
            Archive
          </h2>
          {rounds.length > 0 ? (
            <ul className="mt-3 divide-y divide-(--sh-line-1) border-y border-(--sh-line-1)">
              {rounds.map((round) => (
                <li key={round.week} className="py-3">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      href={`/this-week/${round.week}`}
                      className="text-body font-medium text-(--sh-text-1) underline decoration-transparent underline-offset-2 hover:decoration-current"
                    >
                      {weekLabel(round.week)}
                    </Link>
                    <span className="text-micro text-(--sh-text-3)">{round.week}</span>
                  </p>
                  <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
                    {round.lines?.regime}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-meta text-(--sh-text-2)">
              No approved weeks yet.
            </p>
          )}
        </section>
      </RoundupLayout>
      <SiteColophon current="/this-week" />
    </PageShell>
  );
}
