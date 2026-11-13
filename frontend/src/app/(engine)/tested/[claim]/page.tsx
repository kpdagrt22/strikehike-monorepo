import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { ShareButton } from "@/components/reference/ShareButton";
import { formatDate, formatPercent } from "@/components/regime/regimeUtils";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { ClaimChart } from "@/components/tested/ClaimChart";
import { referenceDetailGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";
import { CLAIM_IDS, readClaimTest, type ClaimTest } from "@/lib/tested/store";

// A prebuilt JSON file read from the working directory, the same pattern as the
// approved roundups. The three ids are fixed, so anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return CLAIM_IDS.map((claim) => ({ claim }));
}

type Params = { params: Promise<{ claim: string }> };

function descriptionFor(claim: ClaimTest) {
  return `${claim.claim} Tested against the daily S&P 500 record: ${claim.result}`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { claim: id } = await params;
  const claim = await readClaimTest(id);
  if (!claim) {
    return { title: "Claim test not found", robots: { index: false, follow: true } };
  }
  const title = `${claim.title} · ${SITE_NAME}`;
  const description = descriptionFor(claim);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/tested/${claim.id}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      locale: "en_IN",
      alternateLocale: ["en_US"],
      siteName: SITE_NAME,
      url: urlFor(`/tested/${claim.id}`),
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

function pct(value: number, digits = 2) {
  return formatPercent(value * 100, digits);
}

function nextEventLine(next: ClaimTest["next_event"]) {
  if (!next) return null;
  if (next.date) return `Next date: ${formatDate(next.date.slice(0, 10))}`;
  if (next.start && next.end) return `Next window: ${formatDate(next.start)} → ${formatDate(next.end)}`;
  return null;
}

export default async function ClaimTestPage({ params }: Params) {
  const { claim: id } = await params;
  const claim = await readClaimTest(id);
  if (!claim) notFound();

  const comparison = claim.comparison;
  const path = `/tested/${claim.id}`;
  const nextLine = nextEventLine(claim.next_event);
  const full = claim.full_history;

  return (
    <PageShell data-reference-index="tested">
      <JsonLd
        data={referenceDetailGraph({
          path,
          name: claim.title,
          description: descriptionFor(claim),
          dateModified: claim.source.build_date,
          start: claim.series.start,
          end: claim.series.end,
          crumbs: [
            { name: "StrikeHike", path: "/" },
            { name: "Tested", path: "/tested" },
            { name: claim.title, path: `/tested/${claim.id}` },
          ],
        })}
      />

      <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
        <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/tested" className="hover:text-(--sh-text-1)">Tested</Link>
        <span aria-hidden="true"> / </span>
        <span>{claim.title}</span>
      </nav>

      <header className="mt-4 max-w-[760px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">Claim test</p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          {claim.title}
        </h1>
        <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
          <span className="text-(--sh-text-3)">The claim: </span>
          {claim.claim}
        </p>
        <p
          data-claim-result={claim.result_code}
          className="mt-4 rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) px-4 py-3 text-[1.05rem] font-medium leading-snug text-(--sh-text-1)"
        >
          {claim.result}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ShareButton surface="tested" url={urlFor(path)} title={claim.title} />
          <Link
            href="/declines"
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-2) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
          >
            20% S&amp;P falls
          </Link>
          <Link
            href="/regime"
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-2) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
          >
            Open the Regime chart
          </Link>
        </div>
      </header>

      {comparison && claim.published ? (
        <>
          <div className="mt-8 max-w-[760px]">
            <ClaimChart points={claim.chart} label={`${claim.title}: mean in-window return each year`} />
          </div>

          <section className="mt-8 max-w-[860px]">
            <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
              The numbers
            </h2>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-(--sh-line-1)">
              <table data-claim-table="" className="w-full min-w-[40rem] border-collapse text-left text-micro">
                <thead className="bg-(--sh-surface-float) text-(--sh-text-3)">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-medium uppercase tracking-[0.12em]">Measure</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium uppercase tracking-[0.12em]">
                      In the window
                    </th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium uppercase tracking-[0.12em]">
                      Out of the window
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-(--sh-line-1)">
                    <th scope="row" className="px-3 py-2.5 font-medium text-(--sh-text-1)">Windows</th>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">{comparison.in.n}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">{comparison.out.n}</td>
                  </tr>
                  <tr className="border-t border-(--sh-line-1)">
                    <th scope="row" className="px-3 py-2.5 font-medium text-(--sh-text-1)">Mean return</th>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">{pct(comparison.in.mean_return)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">{pct(comparison.out.mean_return)}</td>
                  </tr>
                  <tr className="border-t border-(--sh-line-1)">
                    <th scope="row" className="px-3 py-2.5 font-medium text-(--sh-text-1)">Median return</th>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">{pct(comparison.in.median_return)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">{pct(comparison.out.median_return)}</td>
                  </tr>
                  <tr className="border-t border-(--sh-line-1)">
                    <th scope="row" className="px-3 py-2.5 font-medium text-(--sh-text-1)">
                      Windows holding a 20% fall start
                    </th>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">
                      {comparison.in.decline_starts} ({pct(comparison.in.decline_share, 1)})
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">
                      {comparison.out.decline_starts} ({pct(comparison.out.decline_share, 1)})
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p data-claim-stats="" className="mt-3 text-micro leading-relaxed text-(--sh-text-3)">
              Mean difference {pct(comparison.mean_difference, 3)} · median difference{" "}
              {pct(comparison.median_difference, 3)} · permutation p = {comparison.p_value.toFixed(4)} (
              {comparison.permutations} shuffles, seed {comparison.seed}).
            </p>
          </section>
        </>
      ) : (
        <section
          data-claim-too-few=""
          className="mt-8 max-w-[760px] rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) px-4 py-3 text-meta leading-relaxed text-(--sh-text-2)"
        >
          <p className="font-medium text-(--sh-text-1)">{claim.result}</p>
          <p className="mt-2">
            A claim is published only when it has at least 30 non-overlapping daily windows. This
            record does not meet that minimum, so no comparison is shown.
          </p>
        </section>
      )}

      <section className="mt-8 max-w-[760px]">
        <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
          How this was tested
        </h2>
        <ul className="mt-3 space-y-2 text-meta leading-relaxed text-(--sh-text-2)">
          {claim.method.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden="true" className="text-(--sh-text-3)">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {comparison && claim.published ? (
        <section className="mt-8 max-w-[860px]">
          <details className="group rounded-2xl border border-(--sh-line-1)">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-2)">
              <span>Windows ({claim.windows.length})</span>
              <span aria-hidden="true" className="text-base transition-transform group-open:rotate-45">+</span>
            </summary>
          <div className="border-t border-(--sh-line-1)">
            <div className="max-h-[24rem] overflow-y-auto">
              <table data-claim-windows="" className="w-full border-collapse text-left text-micro">
                <thead className="sticky top-0 bg-(--sh-surface-float) text-(--sh-text-3)">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium uppercase tracking-[0.12em]">Start</th>
                    <th scope="col" className="px-3 py-2 font-medium uppercase tracking-[0.12em]">End</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium uppercase tracking-[0.12em]">Return</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium uppercase tracking-[0.12em]">20% fall start</th>
                  </tr>
                </thead>
                <tbody>
                  {claim.windows.map((window) => (
                    <tr key={`${window.start}-${window.end}-${window.kind}`} className="border-t border-(--sh-line-1)">
                      <td className="whitespace-nowrap px-3 py-2 text-(--sh-text-2)">{formatDate(window.start)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-(--sh-text-2)">{formatDate(window.end)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-(--sh-text-2)">{pct(window.return)}</td>
                      <td className="px-3 py-2 text-right text-(--sh-text-3)">{window.decline_start ? "yes" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          </details>
        </section>
      ) : null}

      <section className="mt-8 max-w-[760px]">
        <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">Limitations</h2>
        <ul className="mt-3 space-y-2 text-meta leading-relaxed text-(--sh-text-2)">
          {claim.limitations.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden="true" className="text-(--sh-text-3)">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6 max-w-[760px] rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) px-4 py-3 text-micro leading-relaxed text-(--sh-text-3)">
        <p>
          Source: {claim.series.name}, {claim.series.frequency} closes {claim.series.years} (
          {claim.source.market}). The whole record runs {claim.series.full_record.years}. Built{" "}
          {claim.source.build_date} with {claim.source.astronomy}.
        </p>
        <p className="mt-2">
          {full.available ? (
            <>
              Whole-record check at monthly resolution: in-window mean {pct(full.in.mean_return)} against{" "}
              {pct(full.out.mean_return)} outside ({full.in.n} against {full.out.n} months, permutation p ={" "}
              {full.p_value.toFixed(4)}).
            </>
          ) : (
            <>Whole-record check at monthly resolution: {full.reason}</>
          )}
        </p>
      </section>

      <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-(--sh-text-3)">
        <Link href="/declines" className="hover:text-(--sh-text-1)">20% S&amp;P falls</Link>
        <span aria-hidden="true">·</span>
        <Link href="/regime" className="hover:text-(--sh-text-1)">Regime</Link>
        <span aria-hidden="true">·</span>
        <Link href="/upcoming" className="hover:text-(--sh-text-1)">Upcoming dates</Link>
        {nextLine ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{nextLine}</span>
          </>
        ) : null}
      </p>

      <SiteColophon current="/tested" />
    </PageShell>
  );
}
