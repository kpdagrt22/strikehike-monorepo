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
  formatSigned,
} from "@/components/regime/regimeUtils";
import {
  recessionFacts,
  recessionPath,
  recessionsComplete,
} from "@/lib/reference/reference";
import { getRegimeAtlas } from "@/lib/seo/data";
import { referenceIndexGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const PATH = "/recessions";
const TITLE = "NBER recessions since 1854";
const DESCRIPTION =
  "Every NBER recession in the StrikeHike macro atlas: its dates, length, the S&P fall measured inside it and the lowest Core Index reading in the window.";

export async function generateMetadata(): Promise<Metadata> {
  const atlas = await getRegimeAtlas().catch(() => null);
  const complete = recessionsComplete(atlas);
  return {
    title: { absolute: `${TITLE} · ${SITE_NAME}` },
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
      title: `${TITLE} · ${SITE_NAME}`,
      description: DESCRIPTION,
    },
    twitter: {
      card: "summary_large_image",
      title: `${TITLE} · ${SITE_NAME}`,
      description: DESCRIPTION,
    },
  };
}

export default async function RecessionsPage() {
  const atlas = await getRegimeAtlas().catch(() => null);
  const complete = recessionsComplete(atlas);
  const facts = atlas
    ? atlas.crashes
        .slice()
        .sort((left, right) => left.start.localeCompare(right.start))
        .map((crash) => recessionFacts(atlas, crash))
    : [];
  const asOf = atlas?.as_of?.slice(0, 10) ?? "2026-11-10";
  const withFall = facts.filter((fact) => fact.drawdown != null).length;
  const withScore = facts.filter((fact) => fact.coreLow != null).length;

  return (
    <PageShell data-reference-index="recessions">
      {complete ? (
        <JsonLd
          data={referenceIndexGraph({
            path: PATH,
            name: TITLE,
            description: DESCRIPTION,
            dateModified: asOf,
            start: atlas?.coverage?.start?.slice(0, 10),
            end: atlas?.coverage?.end?.slice(0, 10),
            variableMeasured: [
              "Recession dates",
              "Length in days",
              "S&P fall in the window (%)",
              "Lowest Core Index in the window",
            ],
            sources: [
              "https://fred.stlouisfed.org/series/USREC",
              "https://fred.stlouisfed.org/series/M1125AUSM343NNBR",
            ],
            crumbs: [
              { name: "StrikeHike", path: "/" },
              { name: "Regime", path: "/regime" },
              { name: "NBER recessions", path: PATH },
            ],
          })}
        />
      ) : null}

      <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
        <Link href="/" className="hover:text-(--sh-text-1)">
          StrikeHike
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href="/regime" className="hover:text-(--sh-text-1)">
          Regime
        </Link>
        <span aria-hidden="true"> / </span>
        <span>NBER recessions</span>
      </nav>

      <header className="mt-4 max-w-[760px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
          Reference
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          NBER recessions
        </h1>
        <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
          Every NBER recession in the macro atlas, with its dates, length, the
          S&amp;P fall measured inside it and the lowest Core Index reading.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ShareButton surface="recession" url={urlFor(PATH)} title={TITLE} />
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
          title="The recession reference is unavailable right now."
          detail="The macro archive did not answer. Try again in a moment."
        />
      ) : (
        <>
          <p className="mt-6 text-meta text-(--sh-text-3)">
            {facts.length} windows · {withFall} with an S&amp;P fall ·{" "}
            {withScore} with a Core Index low. The first scored week is{" "}
            {formatDate(atlas?.meta?.core_index_first_scored)}.
          </p>

          <div className="mt-3 overflow-x-auto rounded-2xl border border-(--sh-line-1)">
            <table
              data-reference-table="recessions"
              className="w-full min-w-[48rem] border-collapse text-left text-micro"
            >
              <thead className="bg-(--sh-surface-float) text-(--sh-text-3)">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-medium uppercase tracking-[0.12em]">
                    Window
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium uppercase tracking-[0.12em]">
                    Dates
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium uppercase tracking-[0.12em]">
                    Length
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium uppercase tracking-[0.12em]">
                    S&amp;P fall
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium uppercase tracking-[0.12em]">
                    Core Index low
                  </th>
                </tr>
              </thead>
              <tbody>
                {facts.map((fact) => (
                  <tr
                    key={fact.crash.id}
                    data-reference-row=""
                    className="border-t border-(--sh-line-1)"
                  >
                    <th scope="row" className="px-3 py-2.5 font-medium text-(--sh-text-1)">
                      <Link
                        href={recessionPath(fact.crash.id)}
                        className="underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:decoration-current"
                      >
                        {fact.crash.name}
                      </Link>
                    </th>
                    <td className="whitespace-nowrap px-3 py-2.5 text-(--sh-text-2)">
                      {formatDate(fact.crash.start)} → {formatDate(fact.crash.end)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">
                      {fact.length == null ? "—" : `${formatNumber(fact.length)} days`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">
                      {fact.drawdown == null
                        ? "—"
                        : formatPercent(fact.drawdown, 1)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-(--sh-text-2)">
                      {fact.coreLow == null ? "—" : formatSigned(fact.coreLow)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-micro leading-relaxed text-(--sh-text-3)">
            The S&amp;P fall is the largest fall from a running peak to a later
            low inside each window, on the weekly S&amp;P proxy. Early windows
            predate the price series; their fall and score read “—”.
          </p>
        </>
      )}

      <SiteColophon current={PATH} />
    </PageShell>
  );
}
