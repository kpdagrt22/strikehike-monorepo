import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { DataUnavailable } from "@/components/states/DataUnavailable";
import { referenceIndexGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";
import { readClaimTests } from "@/lib/tested/store";

const PATH = "/tested";
const TITLE = "Tested: popular claims, against the record";
const DESCRIPTION =
  "Three popular sky claims tested against the daily S&P 500 record since 1928: Mercury retrograde, the full moon and eclipses. Method, windows and results shown, including no difference.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} · ${SITE_NAME}` },
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: {
    type: "website",
    locale: "en_IN",
    alternateLocale: ["en_US"],
    siteName: SITE_NAME,
    url: urlFor(PATH),
    title: `${TITLE} · ${SITE_NAME}`,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: `${TITLE} · ${SITE_NAME}`, description: DESCRIPTION },
};

export default async function TestedIndexPage() {
  const claims = await readClaimTests();

  return (
    <PageShell data-reference-index="tested">
      <JsonLd
        data={referenceIndexGraph({
          path: PATH,
          name: TITLE,
          description: DESCRIPTION,
          dateModified: claims[0]?.source.build_date ?? "2026-11-11",
          start: claims[0]?.series.start,
          end: claims[0]?.series.end,
          variableMeasured: [
            "Mean window return",
            "Median window return",
            "Share of windows holding a 20% fall start",
            "Permutation p-value",
          ],
          sources: [
            "https://fred.stlouisfed.org/series/M1125AUSM343NNBR",
            "https://finance.yahoo.com/quote/%5EGSPC/",
          ],
          crumbs: [
            { name: "StrikeHike", path: "/" },
            { name: "Tested", path: PATH },
          ],
        })}
      />

      <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
        <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
        <span aria-hidden="true"> / </span>
        <span>Tested</span>
      </nav>

      <header className="mt-4 max-w-[760px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">Tested</p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          Popular claims, tested against the record
        </h1>
        <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
          Three claims that link the sky to the market, each measured the same way against the
          daily S&amp;P 500 record. Every result is shown, including the ones that find no
          difference.
        </p>
      </header>

      {claims.length === 0 ? (
        <DataUnavailable
          title="The claim tests are unavailable right now."
          detail="The prebuilt files did not load. Try again in a moment."
        />
      ) : (
        <ul className="mt-8 grid max-w-[860px] gap-3 sm:grid-cols-2">
          {claims.map((claim) => (
            <li key={claim.id}>
              <Link
                href={`/tested/${claim.id}`}
                data-claim-card={claim.id}
                className="flex h-full flex-col rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-4 transition-colors hover:bg-(--sh-hover)"
              >
                <span className="text-[1.05rem] font-medium leading-snug text-(--sh-text-1)">
                  {claim.title}
                </span>
                <span className="mt-2 text-meta leading-relaxed text-(--sh-text-2)">{claim.claim}</span>
                <span className="mt-3 text-micro font-medium text-(--sh-text-1)">{claim.result}</span>
                <span className="mt-3 text-micro text-(--sh-text-3)">
                  {claim.comparison.in.n} windows · p = {claim.comparison.p_value.toFixed(4)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 max-w-[760px] text-micro leading-relaxed text-(--sh-text-3)">
        Built ahead of time by <code>backend/scripts/build_claim_tests.py</code> and stored as JSON.
        The method box on each page lists every choice, and the full history is reported even where
        it cannot separate a window from an ordinary period.
      </p>

      <SiteColophon current="/tested" />
    </PageShell>
  );
}
