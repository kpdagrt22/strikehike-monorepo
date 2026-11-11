import {
  formatDate,
  formatSigned,
  padReadout,
} from "@/components/regime/regimeUtils";
import type { RegimeSummary } from "@/lib/seo/data";

// Server-rendered "Now" line and chart frame. It is replaced by the live HUD
// when the lite payload arrives; the frame reserves the chart's height.
export function RegimeBoot({ summary }: { summary: RegimeSummary | null }) {
  const latest = summary?.meta?.latest_core_index;
  return (
    <div data-regime-boot="" className="mt-4">
      <div className="min-h-[8.25rem] sm:min-h-[9.5rem]">
        <p className="text-micro font-medium uppercase tracking-[0.2em] text-black/60 dark:text-white/60">
          Now
          {latest?.date ? ` · week of ${formatDate(latest.date)}` : ""}
        </p>
        <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
          <div className="flex items-end gap-1.5 sm:gap-2">
            <span className="inline-block w-[calc(5ch-0.375em)] text-right font-mono text-[2.9rem] font-medium leading-[0.78] tracking-[-0.075em] tabular-nums text-(--sh-text-1) sm:text-[3.5rem]">
              {padReadout(formatSigned(latest?.score), 5)}
            </span>
            <span className="pb-1 font-mono text-micro text-black/60 dark:text-white/60">
              / +50
            </span>
          </div>
          <p className="pb-0.5 text-lg font-semibold leading-none tracking-[-0.04em] text-(--sh-text-1) sm:text-2xl">
            {latest ? "Latest reading" : "Reading the archive"}
          </p>
        </div>
        <p className="mt-1 text-micro text-black/60 dark:text-white/60">
          {latest
            ? "The weekly history is loading below."
            : "The weekly history is on its way."}
        </p>
      </div>
      <div
        aria-hidden="true"
        className="relative h-[68vh] min-h-[560px] w-full rounded-2xl border border-(--sh-line-1) bg-(--sh-hover)"
      />
    </div>
  );
}
