import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { ShareButton } from "@/components/reference/ShareButton";
import { DataUnavailable } from "@/components/states/DataUnavailable";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import {
  formatDate,
  formatNumber,
  formatPercent,
} from "@/components/regime/regimeUtils";
import {
  daysBetween,
  declinePath,
  declinesComplete,
  trendRecord,
} from "@/lib/reference/reference";
import { getRegimeAtlas } from "@/lib/seo/data";
import { referenceIndexGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const PATH = "/declines";
const TITLE = "20% S&P falls since 1928";
const DESCRIPTION =
  "Every fall of 20% or more in the daily S&P 500 since 1928, as Method & record lists it: dates, depth, and whether the trend warning came before the first 20% of the fall. Misses included.";

export async function generateMetadata(): Promise<Metadata> {
  const atlas = await getRegimeAtlas().catch(() => null);
  const complete = declinesComplete(atlas?.meta);
  return {
    title: { absolute: `${TITLE} — ${SITE_NAME}` },
    description: DESCRIPTION,
    alternates: { canonical: PATH },
    robots: complete
      ? { index: true, follow: true }
      : { index: false, follow: true },
    openGraph: {
      type: "website",
      locale: "en_IN",
      alternateLocale: ["en_US"],
      siteName: SITE_NAME,
      url: urlFor(PATH),
      title: `${TITLE} — ${SITE_NAME}`,
      description: DESCRIPTION,
    },
    twitter: {
      card: "summary_large_image",
      title: `${TITLE} — ${SITE_NAME}`,
      description: DESCRIPTION,
    },
  };
}

export default async function DeclinesPage() {
  const atlas = await getRegimeAtlas().catch(() => null);
  const record = trendRecord(atlas?.meta);
  const complete = declinesComplete(atlas?.meta);
  const falls = record?.falls ?? [];
  const asOf = atlas?.as_of?.slice(0, 10) ?? "2026-11-10";
  const onTime = record?.onWithinFirst20Pct ?? falls.filter((fall) => fall.within_first_20pct).length;
  const late = record?.notWithinFirst20Pct ?? falls.filter((fall) => !fall.within_first_20pct).length;

  return (
    <PageShell data-reference-index="declines">
      {complete ? (
        <JsonLd
          data={referenceIndexGraph({
            path: PATH,
            name: TITLE,
            description: DESCRIPTION,
            dateModified: asOf,
            start: falls[0]?.peak,
            end: falls.at(-1)?.low,
            variableMeasured: [
              "Peak date",
              "Low date",
              "Length in days",
              "S&P fall (%)",
              "Trend warning timing",
            ],
            sources: [
              "https://fred.stlouisfed.org/series/SP500",
              "https://fred.stlouisfed.org/series/M1125AUSM343NNBR",
            ],
            crumbs: [
              { name: "StrikeHike", path: "/" },
              { name: "Regime", path: "/regime" },
              { name: "20% S&P falls", path: PATH },
            ],
          })}
        />
      ) : null}

      <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
        <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/regime" className="hover:text-(--sh-text-1)">Regime</Link>
        <span aria-hidden="true"> / </span>
        <span>20% S&amp;P falls</span>
      </nav>

      <header className="mt-4 max-w-[760px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
          Reference
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          20% S&amp;P falls
        </h1>
        <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
          Every fall of 20% or more in the daily S&amp;P 500 since 1928 that
          Method &amp; record lists, with the trend warning&apos;s first-20%
          record shown for each, misses included.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ShareButton surface="decline" url={urlFor(PATH)} title={TITLE} />
          <Link
            href="/regime"
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-2) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
          >
            Open the Regime chart
          </Link>
        </div>
      </header>

      {!complete ? (
        <DataUnavailable
          title="The decline reference is unavailable right now."
          detail="The macro archive did not answer. Try again in a moment."
        />
      ) : (
        <>
          <p className="mt-6 text-meta text-(--sh-text-3)">
            {falls.length} falls · {onTime} warned before the first 20% of the
            fall · {late} later. A miss is shown as later, not left out.
          </p>

          <div className="mt-3 overflow-x-auto rounded-2xl border border-(--sh-line-1)">
            <table
              data-reference-table="declines"
              className="w-full min-w-[48rem] border-collapse text-left text-micro"
            >
              <thead className="bg-(--sh-surface-float) text-(--sh-text-3)">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-medium uppercase tracking-[0.12em]">Fall</th>
                  <th scope="col" className="px-3 py-2.5 font-medium uppercase tracking-[0.12em]">Peak → low</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium uppercase tracking-[0.12em]">Length</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium uppercase tracking-[0.12em]">S&amp;P fall</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium uppercase tracking-[0.12em]">Warning timing</th>
                </tr>
              </thead>
              <tbody>
                {falls.map((fall) => {
                  const length = daysBetween(fall.peak, fall.low);
                  return (
                    <tr key={fall.id} data-reference-row="" className="border-t border-(--sh-line-1)">
                      <th scope="row" className="px-3 py-2.5 font-medium text-(--sh-text-1)">
                        <Link
                          href={declinePath(fall.id)}
                          className="underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:decoration-current"
                        >
                          {fall.name}
                        </Link>
                      </th>
                      <td className="whitespace-nowrap px-3 py-2.5 text-(--sh-text-2)">
                        {formatDate(fall.peak)} → {formatDate(fall.low)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">
                        {length == null ? "—" : `${formatNumber(length)} days`}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">
                        {formatPercent(-fall.size * 100, 0)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-(--sh-text-2)">
                        {fall.within_first_20pct
                          ? "Before the first 20%"
                          : "After the first 20%"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 max-w-[760px] text-micro leading-relaxed text-(--sh-text-3)">
            The fall is the daily S&amp;P 500 close 20% or more below a running
            peak; a new fall inside a long recovery counts separately. “Before
            the first 20%” means the trend warning was on before the first
            Friday whose close had done a fifth of the eventual fall.
          </p>
        </>
      )}

      <SiteColophon current={PATH} />
    </PageShell>
  );
}
