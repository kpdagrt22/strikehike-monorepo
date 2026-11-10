"use client";

import Link from "next/link";
import { dateTravelled } from "@/lib/analytics/events";
import { recessionPath } from "@/lib/reference/reference";
import {
  formatDate,
  formatPercent,
  formatSigned,
} from "@/components/regime/regimeUtils";

// Every NBER window already in the payload, with the two figures the chart
// already computes for it (the S&P proxy drawdown and the lowest Core Index).
// Selecting a row reuses the page's crash selection: the chart zooms, ?d=
// updates, and the detail panel opens.
export function RecessionWindows({
  metrics = [],
  crashes = [],
  selectedId = null,
  onSelect,
}) {
  const byId = new Map(crashes.map((crash) => [crash.id, crash]));
  if (metrics.length === 0) return null;

  return (
    <section
      aria-labelledby="recession-windows-title"
      className="mt-4 rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="recession-windows-title"
          className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)"
        >
          Recession windows
        </h2>
        <p className="text-micro text-(--sh-text-3)">
          {metrics.length} NBER windows · select one to zoom the chart ·{" "}
          <Link
            href="/recessions"
            className="underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
          >
            All recession pages
          </Link>
        </p>
      </div>

      <div className="mt-3 max-h-[20rem] overflow-auto">
        <table className="w-full min-w-[38rem] border-collapse text-left text-micro">
          <thead className="sticky top-0 z-10 bg-(--sh-surface-overlay) backdrop-blur-xl">
            <tr className="text-(--sh-text-3)">
              <th scope="col" className="py-2 pr-3 font-medium uppercase tracking-[0.12em]">
                Window
              </th>
              <th scope="col" className="px-3 py-2 font-medium uppercase tracking-[0.12em]">
                Dates
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium uppercase tracking-[0.12em]">
                S&amp;P drawdown
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium uppercase tracking-[0.12em]">
                Core Index low
              </th>
              <th scope="col" className="py-2 pl-3 text-right font-medium uppercase tracking-[0.12em]">
                <span className="sr-only">Chart</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => {
              const crash = byId.get(metric.id);
              return (
                <tr
                  key={metric.id}
                  data-recession-window={metric.id}
                  className={`border-t border-(--sh-line-1) ${
                    metric.id === selectedId ? "bg-(--sh-selected)" : ""
                  }`}
                >
                  <th
                    scope="row"
                    className="max-w-[16rem] truncate py-2 pr-3 font-medium text-(--sh-text-1)"
                    title={metric.name}
                  >
                    <Link
                      href={recessionPath(metric.id)}
                      className="underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:decoration-current"
                    >
                      {metric.name}
                    </Link>
                  </th>
                  <td className="whitespace-nowrap px-3 py-2 text-(--sh-text-2)">
                    {formatDate(metric.start)} → {formatDate(metric.end)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-(--sh-text-2)">
                    {metric.drawdown == null
                      ? "—"
                      : formatPercent(metric.drawdown, 1)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-(--sh-text-2)">
                    {metric.score == null ? "—" : formatSigned(metric.score)}
                  </td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right">
                    <button
                      type="button"
                      disabled={!crash}
                      onClick={() => {
                        if (!crash) return;
                        dateTravelled("crash_band", crash.start);
                        onSelect?.(crash);
                      }}
                      aria-label={`Zoom the chart to ${metric.name}`}
                      className="inline-flex min-h-8 items-center rounded-full border border-(--sh-line-2) px-2.5 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) focus-visible:text-(--sh-text-1) pointer-coarse:min-h-11 disabled:opacity-50"
                    >
                      Zoom
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
