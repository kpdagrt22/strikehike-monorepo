import { Fragment } from "react";
import { DetailsTracker } from "@/components/analytics/DetailsTracker";
import { formatCaseDate, formatMonth, formatPct, isOpen } from "@/lib/regime/caseCompare";
import type { CaseCatalogue, DeclineCase, NberWindow, RegimeSummary } from "@/lib/seo/data";
import { FIGURE, PLUS, ROW, SOURCE_LINE, TABLE_REGION, TH_COL, TH_WRAP } from "./styles";

// /regime's own Method & limits, so the two closed rows read as one set.
const DETAILS =
  "group mt-4 rounded-[1.4rem] border border-(--sh-line-1) bg-white/45 p-5 dark:bg-black/25 sm:p-6";
const SUMMARY =
  "-m-2 flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-2 text-micro font-medium uppercase tracking-[0.16em] text-black/60 [&::-webkit-details-marker]:hidden dark:text-white/60";

type DeclineCell = { cases: DeclineCase[] } | { none: string };

/**
 * Every NBER recession window the /regime chart draws, as a table closed by default, with the
 * US stock declines from the Convergence catalogue whose peak-to-low window overlaps each one
 * (the catalogue's own `recessions` ids; no figure is computed here). A Server Component: the
 * rows are in the HTML every crawler reads, before and after hydration alike. Without the
 * catalogue the declines column is left out, so it never claims that no decline happened.
 */
export function NberTable({
  summary,
  catalogue,
}: {
  summary: RegimeSummary | null;
  catalogue: CaseCatalogue | null;
}) {
  const windows: NberWindow[] = summary?.crashes ?? [];
  if (!summary || windows.length === 0) return null;
  const title = `Every NBER recession since ${String(windows[0].start_month).slice(0, 4)}`;

  const threshold = catalogue?.kinds.find((kind) => kind.key === "us_equity")?.threshold_pct;
  const stockStart = catalogue?.coverage?.series_first_obs?.sp500;
  const usCases = catalogue?.cases.filter((c) => c.kind === "us_equity") ?? [];
  const withDeclines = typeof threshold === "number" && typeof stockStart === "string";
  const declinesFor = (window: NberWindow): DeclineCell => {
    if (typeof stockStart === "string" && String(window.end) < stockStart) {
      return { none: `No US stock data before ${stockStart.slice(0, 4)}` };
    }
    const cases = usCases.filter((c) => c.recessions?.includes(window.id));
    return cases.length ? { cases } : { none: `No decline of ${threshold}% or more` };
  };

  return (
    <details id="regime-nber-table" className={DETAILS}>
      <DetailsTracker id="regime-nber-table" panel="nber_table" />
      <summary className={SUMMARY}>
        {title}
        <span className={PLUS} aria-hidden="true">
          +
        </span>
      </summary>
      <div role="region" aria-label={title} tabIndex={0} className={`mt-4 ${TABLE_REGION}`}>
        <table className="w-full border-collapse text-meta leading-relaxed text-black/60 dark:text-white/60">
          <caption className="caption-top pb-3 text-left">
            {windows.length} NBER recession windows from FRED (USREC):{" "}
            <span className="whitespace-nowrap">month-precise</span> and dated after the fact.
            {withDeclines
              ? ` Declines are US stock falls of ${threshold}% or more from the Convergence catalogue whose peak-to-low window overlaps the recession.`
              : null}
          </caption>
          <thead>
            <tr>
              <th scope="col" className={TH_COL}>
                Recession
              </th>
              <th scope="col" className={TH_COL}>
                NBER dates
              </th>
              {withDeclines ? (
                <th scope="col" className={TH_WRAP}>
                  US stock declines of {threshold}% or more
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {windows.map((window) => {
              const declines = withDeclines ? declinesFor(window) : null;
              return (
                <tr key={window.id} className={ROW}>
                  <th
                    scope="row"
                    className="py-2 pr-4 text-left font-normal text-[#14121a] dark:text-[#f2ede4]"
                  >
                    {window.name}
                  </th>
                  <td className="py-2 pr-4 font-mono tabular-nums">
                    <span className="whitespace-nowrap">{formatMonth(window.start_month)}</span>
                    {" – "}
                    <span className="whitespace-nowrap">
                      {window.ongoing ? "ongoing" : formatMonth(window.end_month)}
                    </span>
                  </td>
                  {declines ? (
                    <td className="py-2">
                      {"none" in declines
                        ? declines.none
                        : declines.cases.map((c, index) => (
                            <Fragment key={c.id}>
                              {index > 0 ? " · " : null}
                              {c.name} (<span className={FIGURE}>{formatPct(c.depth_pct)}</span>
                              {isOpen(c) ? " so far" : null})
                            </Fragment>
                          ))}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={SOURCE_LINE}>
        Data to <time dateTime={summary.as_of}>{formatCaseDate(summary.as_of)}</time> · FRED ·
        World Bank · Blockchain.com · Yahoo Finance
      </p>
    </details>
  );
}
