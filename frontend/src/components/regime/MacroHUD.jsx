"use client";

import {
  coreIndexTone,
  formatDate,
  formatSigned,
} from "@/components/regime/regimeUtils";
import {
  ASSET_ORDER,
  ASSET_TARGETS,
  assetChartColor,
} from "@/components/regime/assetTargets";

export function MacroHUD({
  point,
  isDark,
  resolution,
  activeCrash,
  assetKey = "sp500",
  onAssetChange,
  compareAssets = false,
  onCompareToggle,
}) {
  const tone = coreIndexTone(point?.core_index_bucket, isDark);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-3 pt-3 pr-20 sm:pb-4 sm:pl-5 sm:pt-5 sm:pr-20 lg:pl-8 lg:pr-20">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-wrap items-end gap-4 sm:gap-8">
          <div className="min-w-0">
            <p className="text-micro font-medium uppercase tracking-[0.2em] text-black/60 dark:text-white/60">
              StrikeHike Core Index
            </p>
            <div className="mt-1 flex items-end gap-1.5 sm:gap-2">
              <span
                className="font-mono text-[2.9rem] font-medium leading-[0.78] tracking-[-0.075em] tabular-nums sm:text-[3.5rem]"
                style={{ color: tone.color }}
              >
                {formatSigned(point?.core_index)}
              </span>
              <span className="pb-1 font-mono text-micro text-black/60 dark:text-white/60">
                / +50
              </span>
            </div>
            <p className="mt-1 font-mono text-micro text-black/60 dark:text-white/60">
              −50 ↔ +50 · contrarian sentiment map
            </p>
          </div>

          <div className="min-w-0 border-l border-black/5 pl-4 dark:border-white/5 sm:pl-6">
            <p className="text-micro font-medium uppercase tracking-[0.2em] text-black/60 dark:text-white/60">
              State · action
            </p>
            <p
              className="mt-1 text-xl font-semibold leading-none tracking-[-0.05em] sm:text-3xl"
              style={{ color: tone.color }}
            >
              {tone.label}
            </p>
            <p className="mt-1.5 max-w-[360px] text-micro leading-relaxed text-black/60 dark:text-white/60">
              <span className="font-semibold uppercase tracking-[0.1em]" style={{ color: tone.color }}>
                Smart money
              </span>{" "}
              {tone.allocation}
            </p>
            <p className="mt-1 max-w-[280px] truncate text-micro text-black/60 dark:text-white/60">
              {activeCrash ? (
                `${activeCrash.name} · NBER window`
              ) : point ? (
                <>
                  <span className="[@media(hover:none)]:hidden">
                    Hover the chart to move through history
                  </span>
                  <span className="hidden [@media(hover:none)]:inline">
                    Press and hold the chart to scrub
                  </span>
                </>
              ) : (
                "Awaiting market archive"
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 xl:items-end">
          <div className="flex flex-wrap items-center gap-1.5">
            <div
              role="group"
              aria-label="Primary asset"
              className="inline-flex items-center gap-0.5 rounded-full border border-black/5 bg-black/[0.025] p-0.5 backdrop-blur-2xl dark:border-white/5 dark:bg-white/[0.035]"
            >
              {ASSET_ORDER.map((key) => {
                const target = ASSET_TARGETS[key];
                const selected = key === assetKey;
                const color = assetChartColor(target, isDark);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onAssetChange?.(key)}
                    aria-pressed={selected}
                    className={`rounded-full px-2.5 py-1 text-micro font-medium transition-[background-color,color] duration-200 ${
                      selected
                        ? ""
                        : "text-black/60 hover:text-black/75 focus-visible:text-black/75 dark:text-white/60 dark:hover:text-white/75 dark:focus-visible:text-white/75"
                    }`}
                    style={
                      selected
                        ? {
                            color,
                            backgroundColor: `${color}1f`,
                          }
                        : undefined
                    }
                  >
                    {target.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onCompareToggle}
              aria-pressed={compareAssets}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-micro font-medium transition-colors ${
                compareAssets
                  ? "border-[#c0442f]/25 bg-[#f05d49]/10 text-[#c0442f] dark:border-[#ff8b77]/25 dark:bg-[#f05d49]/15 dark:text-[#ff8b77]"
                  : "border-black/5 text-black/60 hover:bg-black/[0.04] hover:text-black/75 focus-visible:bg-black/[0.04] focus-visible:text-black/75 dark:border-white/5 dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white/75 dark:focus-visible:bg-white/[0.06] dark:focus-visible:text-white/75"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 17l5-6 4 4 7-9" />
                <path d="M4 21h16" />
              </svg>
              Compare assets
            </button>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 xl:justify-end">
            <span className="inline-flex items-center gap-2 text-micro font-medium uppercase tracking-[0.18em] text-black/60 dark:text-white/60">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: tone.color }}
                aria-hidden="true"
              />
              Date
            </span>
            <p className="font-mono text-lg font-medium tracking-[-0.03em] text-black/75 dark:text-white/80">
              {formatDate(point?.date)}
            </p>
            <p className="text-micro text-black/60 dark:text-white/60">
              {resolution ? `${resolution} tape` : "Market tape"}
              <span className="[@media(hover:none)]:hidden"> · hover to
              scrub</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
