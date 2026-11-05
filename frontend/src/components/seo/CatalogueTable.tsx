import { DetailsTracker } from "@/components/analytics/DetailsTracker";
import { formatCaseDate, formatPct, isOpen, isUnobservable } from "@/lib/regime/caseCompare";
import type { CaseCatalogue, DeclineCase } from "@/lib/seo/data";
import { PLUS, ROW, SOURCE_LINE, TABLE_REGION, TH_COL } from "./styles";

// /convergence's own Method & limits, so the two closed rows read as one set.
const DETAILS =
  "group mt-4 rounded-[1.4rem] border border-(--sh-line-1) bg-(--sh-surface-card) p-5 sm:p-6";
const SUMMARY =
  "-m-2 flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-2 text-micro font-medium uppercase tracking-[0.16em] text-black/60 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden dark:text-white/60";
const DATE = "whitespace-nowrap py-2 pr-4 font-mono tabular-nums";
// The same column widths in every market's table, so the five tables align.
const COLUMNS = [
  ["Decline", "w-[24%]"],
  ["Measured on", "w-[32%]"],
  ["Peak", "w-[11%]"],
  ["Low", "w-[11%]"],
  ["Fall", "w-[9%]"],
  ["Back at peak", ""],
] as const;

const precisionOf = (c: DeclineCase) => (c.series?.precision === "month" ? "month" : "day");

/** "Back at peak", as the ledger words it: the recovery date, "Not observable", or the last
 *  date the series was still short of its peak. */
function backAtPeak(c: DeclineCase, asOf: string) {
  const precision = precisionOf(c);
  if (c.recovery) {
    return <span className="font-mono tabular-nums">{formatCaseDate(c.recovery, precision)}</span>;
  }
  if (isUnobservable(c)) return "Not observable";
  return (
    <>
      Not by{" "}
      <span className="font-mono tabular-nums">
        {formatCaseDate(c.latest?.date ?? asOf, precision)}
      </span>
    </>
  );
}

/**
 * Every decline in the Convergence catalogue, one table per market in the payload's order, closed
 * by default. Every string is payload data (names, rules, series labels, notes) or the page's own
 * ledger wording; dates and depths use the ledger's UTC formatters. A Server Component: the rows
 * are in the HTML every crawler reads, before and after hydration alike.
 */
export function CatalogueTable({ catalogue }: { catalogue: CaseCatalogue | null }) {
  if (!catalogue || catalogue.cases.length === 0) return null;
  const title = `All ${catalogue.cases.length} declines in the catalogue`;
  const notes = Array.isArray(catalogue.notes) ? catalogue.notes : [];

  return (
    <details id="regime-catalogue-table" className={DETAILS}>
      <DetailsTracker id="regime-catalogue-table" panel="catalogue_table" />
      <summary className={SUMMARY}>
        {title}
        <span className={PLUS} aria-hidden="true">
          +
        </span>
      </summary>
      <div className="mt-4 space-y-6">
        {catalogue.kinds.map((kind) => {
          const cases = catalogue.cases.filter((c) => c.kind === kind.key);
          if (cases.length === 0) return null;
          const headingId = `catalogue-kind-${kind.key}`;
          return (
            // The table's scroll region carries the market's name: one named landmark per market.
            <section key={kind.key}>
              <h3
                id={headingId}
                className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60"
              >
                {kind.label} · {cases.length}
              </h3>
              <p className="mt-1 max-w-3xl text-meta leading-relaxed text-black/60 dark:text-white/60">
                {kind.rule}
              </p>
              <div
                role="region"
                aria-labelledby={headingId}
                tabIndex={0}
                className={`mt-2 ${TABLE_REGION}`}
              >
                <table className="w-full min-w-[46rem] border-collapse text-meta leading-relaxed text-black/60 dark:text-white/60">
                  <caption className="sr-only">{kind.label}</caption>
                  <thead>
                    <tr>
                      {COLUMNS.map(([label, width]) => (
                        <th key={label} scope="col" className={`${TH_COL} ${width}`}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((c) => (
                      <tr key={c.id} className={ROW}>
                        <th
                          scope="row"
                          className="whitespace-nowrap py-2 pr-4 text-left font-normal text-[#14121a] dark:text-[#f2ede4]"
                        >
                          {c.name}
                        </th>
                        <td className="py-2 pr-4">{c.series?.label}</td>
                        <td className={DATE}>{formatCaseDate(c.peak, precisionOf(c))}</td>
                        <td className={DATE}>{formatCaseDate(c.trough, precisionOf(c))}</td>
                        <td className="whitespace-nowrap py-2 pr-4">
                          <span className="font-mono tabular-nums">{formatPct(c.depth_pct)}</span>
                          {isOpen(c) ? " so far" : null}
                        </td>
                        <td className="whitespace-nowrap py-2">{backAtPeak(c, catalogue.as_of)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        {notes.length ? (
          <ul className="space-y-2.5">
            {notes.map((note) => (
              <li
                key={note}
                className="flex gap-2 text-meta leading-relaxed text-black/60 dark:text-white/60"
              >
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#f05d49]" aria-hidden="true" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className={SOURCE_LINE}>
        Data to <time dateTime={catalogue.as_of}>{formatCaseDate(catalogue.as_of)}</time> · FRED ·
        World Bank · Blockchain.com · Yahoo Finance
      </p>
    </details>
  );
}
