"use client";

import { assetCompared, cycleMapToggled } from "@/lib/analytics/events";
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
import { CycleMini } from "@/components/regime/CycleMini";
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

// The pill's key to its line: a dot in the line's colour (one asset), or a
// checkbox (compare): filled with the colour and ticked when the line is
// drawn, a 1.5 px outline when it is not. One 12 px box either way, so the
// pills keep their width when compare turns on or off. The tick's ink keeps
// 3:1 or more on every fill (white on the light theme's deep fills, near-black
// on the dark theme's bright ones).
function AssetSwatch({ mode }) {
  if (mode === "dot") {
    return (
      <span aria-hidden="true" className="grid h-3 w-3 shrink-0 place-items-center">
        <span className="h-2 w-2 rounded-full bg-(--asset-light) dark:bg-(--asset-dark)" />
      </span>
    );
  }
  const checked = mode === "checked";
  return (
    <span
      aria-hidden="true"
      className={`grid h-3 w-3 shrink-0 place-items-center rounded-[3px] ${
        checked
          ? "bg-(--asset-light) text-white dark:bg-(--asset-dark) dark:text-[#0b0b12]"
          : "border-[1.5px] border-(--asset-light) dark:border-(--asset-dark)"
      }`}
    >
      {checked ? (
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
          <path
            d="M3.2 6.2l1.9 1.9 3.7-4.1"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

const VALUE_MODES = [
  ["roi", "ROI %"],
  ["price", "Price"],
];
const SHORT_ASSET = {
  sp500: "S&P",
  gold: "Gold",
  bonds: "Bonds",
  nifty: "Nifty",
};

export function MacroHUD({
  point,
  hovering = false,
  isDark,
  activeCrash,
  assetKey = "sp500",
  onAssetChange,
  compareAssets = false,
  onCompareToggle,
  shownAssets = [],
  onShownToggle,
  valueMode = "roi",
  onValueModeChange,
  cycleOn = true,
  onCycleToggle,
  cycle = null,
  marketFlags = [],
}) {
  const tone = coreIndexTone(point?.core_index_bucket, isDark);
  // Shown only when the week has them. A warning leaves the band line as it is.
  const flag = coreIndexFlag(point);
  const flagsOn = marketFlags.filter((item) => point?.[item.field] === true);
  // One flag shows its text (naming the week's index); two show their labels.
  const flagText = flagsOn.length === 1 ? marketFlagText(flagsOn[0], point) : "";

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-2 pt-2 sm:px-5 sm:pb-3 sm:pt-4 lg:px-8">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
        {/* One readout, one date: "Now" at rest, the hovered week while
            scrubbing, with the band label inside it (not a second block). */}
        <div className="min-w-0" data-regime-readout="">
          <p className="text-micro font-medium uppercase tracking-[0.2em] text-black/60 dark:text-white/60">
            {hovering ? "Hovered" : activeCrash ? "Window start" : "Now"}
            {point?.date ? ` · week of ${formatDate(point.date)}` : ""}
          </p>
          <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
            <div className="flex items-end gap-1.5 sm:gap-2">
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
            <p
              className="pb-0.5 text-lg font-semibold leading-none tracking-[-0.04em] sm:text-2xl"
              style={{ color: tone.color }}
            >
              {tone.label}
            </p>
          </div>
          <CoreIndexScale value={point?.core_index} color={tone.color} />
          <p className="mt-1 max-w-[560px] text-micro leading-relaxed text-black/60 dark:text-white/60">
            Band {tone.description}.{" "}
            {tone.description !== "—" ? (
              <a
                href="#regime-method"
                onClick={() => {
                  // The record sits in a closed <details>: open it, then let
                  // the link scroll to it.
                  const method = document.getElementById("regime-method");
                  if (method && "open" in method) method.open = true;
                }}
                className="whitespace-nowrap underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current focus-visible:decoration-current"
              >
                What followed similar readings →
              </a>
            ) : null}
          </p>

          {flag ? (
            <p className="mt-1 max-w-[360px] truncate text-micro text-black/60 dark:text-white/60">
              <span className="font-semibold uppercase tracking-[0.1em] text-black/70 dark:text-white/70">
                {flag.label}
              </span>{" "}
              {flag.text}
            </p>
          ) : activeCrash ? (
            <p className="mt-1 max-w-[360px] truncate text-micro text-black/60 dark:text-white/60">
              {activeCrash.name} · NBER window
            </p>
          ) : null}

          {marketFlags.length ? (
            <p
              key={`${flagsOn.map((item) => item.field).join("|")}|${flagText}`}
              className="mt-1 min-h-[1.35em] max-w-[420px] truncate text-micro text-black/60 dark:text-white/60"
            >
              {flagsOn.length ? (
                flagsOn.map((item, index) => (
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
                ))
              ) : (
                <span aria-hidden="true">{"\u00a0"}</span>
              )}
            </p>
          ) : null}

          {cycle ? (
            <div className="mt-1 w-full max-w-[260px]">
              <CycleMini
                trail={cycle.trail}
                assetLabel={cycle.assetLabel}
                isDark={isDark}
                ringColor={isDark ? "#06060a" : "#f6f1e9"}
              />
            </div>
          ) : null}
        </div>

        {/* From xl this column keeps the controls' width; below it the row
            sits under the readout. All four controls stay on one line. */}
        <div className="flex min-w-0 flex-col items-start gap-2 xl:shrink-0 xl:items-end">
          <div
            data-regime-controls=""
            className="flex w-full flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-1 xl:w-auto xl:flex-wrap xl:overflow-visible"
          >
            {/* The pills are the chart's key: each carries its line's colour.
                One asset: a click picks it. Compare: each is a checkbox for
                its line; the last line drawn stays checked (aria-disabled),
                with nothing in the layout changing. */}
            <div
              role="group"
              aria-label={compareAssets ? "Assets on the chart" : "Primary asset"}
              className="inline-flex shrink-0 items-center gap-0 rounded-full border border-black/5 bg-black/[0.025] p-0.5 dark:border-white/5 dark:bg-white/[0.035]"
            >
              {ASSET_ORDER.map((key) => {
                const target = ASSET_TARGETS[key];
                const colors = {
                  "--asset-light": target.light,
                  "--asset-dark": target.dark,
                };
                if (compareAssets) {
                  const checked = shownAssets.includes(key);
                  const locked = checked && shownAssets.length === 1;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-disabled={locked ? "true" : undefined}
                      aria-label={target.label}
                      title={locked ? "At least one asset stays on the chart" : undefined}
                      onClick={() => {
                        if (!locked) {
                          assetCompared(
                            checked ? "remove" : "add",
                            key === "nifty" ? "nifty50" : key,
                            checked ? shownAssets.length - 1 : shownAssets.length + 1,
                          );
                          onShownToggle?.(key);
                        }
                      }}
                      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-0.5 py-1 text-micro font-medium transition-colors duration-200 aria-disabled:cursor-default sm:px-2 lg:gap-1.5 lg:px-2.5 ${
                        checked
                          ? "text-black/80 dark:text-white/85"
                          : "text-black/60 hover:text-black/75 focus-visible:text-black/75 dark:text-white/60 dark:hover:text-white/75 dark:focus-visible:text-white/75"
                      }`}
                      style={colors}
                    >
                      <AssetSwatch mode={checked ? "checked" : "unchecked"} />
                      <span className="hidden sm:inline">{target.label}</span>
                      <span className="sm:hidden">{SHORT_ASSET[key]}</span>
                    </button>
                  );
                }
                const selected = key === assetKey;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-label={target.label}
                    onClick={() => {
                      assetCompared(
                        "select",
                        key === "nifty" ? "nifty50" : key,
                      );
                      onAssetChange?.(key);
                    }}
                    aria-pressed={selected}
                    className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-0.5 py-1 text-micro font-medium transition-[background-color,color] duration-200 sm:px-2 lg:gap-1.5 lg:px-2.5 ${
                      selected
                        ? "bg-white/80 text-(--asset-light) dark:bg-(--asset-dark)/12 dark:text-(--asset-dark)"
                        : "text-black/60 hover:text-black/75 focus-visible:text-black/75 dark:text-white/60 dark:hover:text-white/75 dark:focus-visible:text-white/75"
                    }`}
                    style={colors}
                  >
                    <AssetSwatch mode="dot" />
                    <span className="hidden sm:inline">{target.label}</span>
                    <span className="sm:hidden">{SHORT_ASSET[key]}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                assetCompared(
                  compareAssets ? "compare_off" : "compare_on",
                  "",
                  shownAssets.length,
                );
                onCompareToggle?.();
              }}
              aria-pressed={compareAssets}
              aria-label="Compare assets"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-1.5 py-1.5 text-micro font-medium sm:px-3 transition-colors ${
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
              <span className="hidden sm:inline">Compare assets</span>
            </button>

            {/* What the lines show: the return since the base week, or each
                asset's own price. */}
            <div
              role="group"
              aria-label="Chart values"
              className="inline-flex shrink-0 items-center gap-0 rounded-full border border-black/5 bg-black/[0.025] p-0.5 dark:border-white/5 dark:bg-white/[0.035]"
            >
              {VALUE_MODES.map(([mode, label]) => {
                const selected = mode === valueMode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onValueModeChange?.(mode)}
                    aria-pressed={selected}
                    className={`whitespace-nowrap rounded-full px-0.5 py-1 text-micro font-medium transition-[background-color,color] duration-200 sm:px-2 lg:px-2.5 ${
                      selected
                        ? "bg-white/80 text-[#14121a] dark:bg-white/[0.08] dark:text-[#f2ede4]"
                        : "text-black/60 hover:text-black/75 focus-visible:text-black/75 dark:text-white/60 dark:hover:text-white/75 dark:focus-visible:text-white/75"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Shows or hides the small cycle map in the readout (the full
                map below the chart stays). */}
            <button
              type="button"
              onClick={() => {
                cycleMapToggled(cycleOn ? "off" : "on");
                onCycleToggle?.();
              }}
              aria-pressed={cycleOn}
              aria-label="Cycle map"
              title="The 90-day cycle map in the readout"
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-1.5 py-1.5 text-micro font-medium sm:px-3 transition-colors ${
                cycleOn
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
                <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
                <path d="M12 3.5v17M3.5 12h17" />
              </svg>
              <span className="hidden sm:inline">Cycle map</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
