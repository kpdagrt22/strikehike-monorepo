"use client";

import {
  coreIndexTone,
  formatDate,
  formatSigned,
  padReadout,
} from "@/components/regime/regimeUtils";
import {
  ASSET_ORDER,
  ASSET_TARGETS,
} from "@/components/regime/assetTargets";
import { coreIndexFlag, marketFlagText } from "@/components/regime/regimeChart";

// A slim −50…+50 track under the score: ticks at −25, 0 and +25 and a marker
// at the current value in its band's tone. The marker keeps one layout
// position (the track's left end) and moves by a transform, without
// animation, so scrubbing never shifts layout.
function CoreIndexScale({ value, color }) {
  const number = Number(value);
  const known = value != null && Number.isFinite(number);
  const share = (Math.max(-50, Math.min(50, number)) + 50) / 100;
  return (
    <div
      aria-hidden="true"
      className="relative mt-2 h-2 w-(--scale-track) [--scale-track:9rem] sm:[--scale-track:10.5rem]"
    >
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/15 dark:bg-white/15" />
      {[25, 50, 75].map((stop) => (
        <span
          key={stop}
          className={`absolute top-1/2 w-px -translate-x-1/2 -translate-y-1/2 bg-black/30 dark:bg-white/30 ${
            stop === 50 ? "h-2" : "h-1.5"
          }`}
          style={{ left: `${stop}%` }}
        />
      ))}
      {known ? (
        <span
          className="absolute left-0 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full ring-2 ring-[#f5f0e8] dark:ring-[#06060a]"
          style={{
            transform: `translateX(calc(${share} * var(--scale-track) - 50%))`,
            backgroundColor: color,
          }}
        />
      ) : null}
    </div>
  );
}

export function MacroHUD({
  point,
  isDark,
  resolution,
  activeCrash,
  assetKey = "sp500",
  onAssetChange,
  compareAssets = false,
  onCompareToggle,
  marketFlags = [],
}) {
  const tone = coreIndexTone(point?.core_index_bucket, isDark);
  // Shown only when the week has them. A warning while Balanced Growth or
  // Trim leaves the allocation line as it is.
  const flag = coreIndexFlag(point);
  const flagsOn = marketFlags.filter((item) => point?.[item.field] === true);
  // One flag shows its text (naming the week's index); two show their labels.
  const flagText = flagsOn.length === 1 ? marketFlagText(flagsOn[0], point) : "";

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-3 pt-3 pr-20 sm:pb-4 sm:pl-5 sm:pt-5 sm:pr-20 lg:pl-8 lg:pr-20">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-wrap items-end gap-4 sm:gap-8">
          <div className="min-w-0">
            <p className="text-micro font-medium uppercase tracking-[0.2em] text-black/60 dark:text-white/60">
              StrikeHike Core Index
            </p>
            <div className="mt-1 flex items-end gap-1.5 sm:gap-2">
              {/* A fixed five-character box (a signed score with one decimal,
                  "+22.4"), always filled (shorter scores are padded): digits
                  change in place and "/ +50" never moves while scrubbing. */}
              <span
                className="inline-block w-[calc(5ch-0.375em)] text-right font-mono text-[2.9rem] font-medium leading-[0.78] tracking-[-0.075em] tabular-nums sm:text-[3.5rem]"
                style={{ color: tone.color }}
              >
                {padReadout(formatSigned(point?.core_index), 5)}
              </span>
              <span className="pb-1 font-mono text-micro text-black/60 dark:text-white/60">
                / +50
              </span>
            </div>
            <CoreIndexScale value={point?.core_index} color={tone.color} />
            <p className="mt-1 font-mono text-micro text-black/60 dark:text-white/60">
              −50 ↔ +50 · contrarian sentiment map
            </p>
          </div>

          {/* Sized by the row's width, not by the state's text, so it wraps
              under the score at the same widths for every week. */}
          <div className="min-w-[min(16rem,100%)] max-w-[24.0625rem] flex-1 basis-0 border-l border-black/5 pl-4 dark:border-white/5 sm:min-w-[18.25rem] sm:pl-6">
            <p className="text-micro font-medium uppercase tracking-[0.2em] text-black/60 dark:text-white/60">
              State · action
            </p>
            <p
              className="mt-1 text-xl font-semibold leading-none tracking-[-0.05em] sm:text-2xl"
              style={{ color: tone.color }}
            >
              {tone.label}
            </p>
            {/* Lines reserved for the longest allocation (three below sm, two
                from sm), so hovering across buckets never moves the chart. */}
            <p className="mt-1.5 min-h-[4.875em] max-w-[360px] text-micro leading-relaxed text-black/60 dark:text-white/60 sm:min-h-[3.25em]">
              <span className="font-semibold uppercase tracking-[0.1em] text-black/70 dark:text-white/70">
                Smart money
              </span>{" "}
              {tone.allocation}
            </p>
            {/* One line, always: the week's Core Index flag when it has one,
                otherwise the NBER window or the scrub hint. */}
            <p className="mt-1 max-w-[320px] truncate text-micro text-black/60 dark:text-white/60">
              {flag ? (
                <>
                  <span className="font-semibold uppercase tracking-[0.1em] text-black/70 dark:text-white/70">
                    {flag.label}
                  </span>{" "}
                  {flag.text}
                </>
              ) : activeCrash ? (
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
              className="inline-flex items-center gap-0.5 rounded-full border border-black/5 bg-black/[0.025] p-0.5 dark:border-white/5 dark:bg-white/[0.035]"
            >
              {ASSET_ORDER.map((key) => {
                const target = ASSET_TARGETS[key];
                const selected = key === assetKey;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onAssetChange?.(key)}
                    aria-pressed={selected}
                    className={`rounded-full px-2.5 py-1 text-micro font-medium transition-[background-color,color] duration-200 ${
                      selected
                        ? "bg-white/80 text-(--asset-light) dark:bg-(--asset-dark)/12 dark:text-(--asset-dark)"
                        : "text-black/60 hover:text-black/75 focus-visible:text-black/75 dark:text-white/60 dark:hover:text-white/75 dark:focus-visible:text-white/75"
                    }`}
                    style={
                      selected
                        ? {
                            "--asset-light": target.light,
                            "--asset-dark": target.dark,
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
                  ? "border-black/10 bg-black/[0.07] text-[#14121a] dark:border-white/10 dark:bg-white/[0.08] dark:text-[#f2ede4]"
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

          {/* The S&P market flags of the week: one line kept under the date
              (sized by the column, w-0 min-w-full, so its text never widens
              it), so a flag turning on or off never moves the chart. With
              two flags on, only their labels fit. From xl the line sits
              beside the taller score column and costs no height; narrower
              HUDs keep their height, and the snapshot card (the scrub
              readout) and the summary above carry the flags there. The line
              is right-aligned, so it is drawn afresh whenever its content
              changes (keyed by it) rather than sliding what stays in it. */}
          {marketFlags.length ? (
            <p
              key={`${flagsOn.map((item) => item.field).join("|")}|${flagText}`}
              className="hidden min-h-[1.35em] w-0 min-w-full truncate text-right text-micro text-black/60 dark:text-white/60 xl:block"
            >
              {flagsOn.map((item, index) => (
                <span key={item.field}>
                  {index ? <span aria-hidden="true"> · </span> : null}
                  <span
                    aria-hidden="true"
                    className="mr-1.5 inline-block h-0.5 w-3 rounded-full align-middle"
                    style={{ backgroundColor: isDark ? item.dark : item.light }}
                  />
                  <span className="font-semibold uppercase tracking-[0.1em] text-black/70 dark:text-white/70">
                    {item.label}
                  </span>
                  {flagText ? ` ${flagText}` : null}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
