"use client";

import { lazy, Suspense } from "react";
import {
  CHIP_GRID,
  CHIP_SLOT,
  FAN_BOX,
  MIRROR_ROW,
  READOUT_BOX,
  STRIP_BOX,
  STRIP_ROW,
  answerText,
  formatChange,
  formatShare,
  horizonOf,
  mirrorExact,
  mirrorLine,
  setupsLabel,
  skillLine,
} from "@/components/patterns/patternFormat";
import { ASSET_TARGETS } from "@/components/regime/assetTargets";

// Same boxes as the instrument's own loading state, so nothing moves when its
// code arrives. The first load is always the S&P 500 lens (a mirror row).
function InstrumentPlaceholder() {
  return (
    <div aria-hidden="true">
      <div className="mt-2">
        <div className={FAN_BOX} />
      </div>
      <div className={READOUT_BOX} />
      <div className={STRIP_BOX}>
        <p className="text-micro font-medium uppercase tracking-[0.16em] text-(--sh-text-3)">
          Closest setups
        </p>
        <div className={STRIP_ROW}>
          <div className={CHIP_GRID}>
            {Array.from({ length: 10 }, (_, index) => (
              <span key={`slot-${index}`} className={CHIP_SLOT} />
            ))}
          </div>
          <div className={MIRROR_ROW}>
            <span className="mx-1 hidden h-8 w-px bg-(--sh-line-2) sm:block" />
            <span className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
              120 years ago
            </span>
            <span className={CHIP_SLOT} />
          </div>
        </div>
      </div>
    </div>
  );
}

// The chart, readout and years are most of this route's code: they load after
// the page, behind a placeholder of the same geometry. React.lazy, not
// next/dynamic, so the route ships no extra loader runtime; the page renders
// it only once mounted, which keeps it out of the server HTML (ssr: false).
const AnalogInstrument = lazy(() =>
  import("@/components/patterns/AnalogFan").then((mod) => ({ default: mod.AnalogInstrument })),
);

function LegendKey({ className }) {
  return <i className={`inline-block w-4 border-t-2 ${className}`} aria-hidden="true" />;
}

/**
 * Section 01: what happened in the year after the past setups most like
 * today, beside the usual year: the answer, the comparison with all years,
 * the honesty lines, then the instrument (legend, chart, readout, years).
 */
export function PeekIntoFuture({ engine, status, assetKey, isDark, mounted, titleRef }) {
  const viewAsset = ASSET_TARGETS[engine?.asset] ? engine.asset : assetKey;
  const target = ASSET_TARGETS[viewAsset] ?? ASSET_TARGETS.sp500;
  const outlook = engine?.status === "insufficient" ? null : engine?.outlook ?? null;
  const k = outlook?.k ?? engine?.analogs?.length ?? 10;
  const twelve = horizonOf(engine, 12);
  const drawdown = outlook?.drawdown;
  const since = outlook?.usual_since_year ?? "—";
  const answer = answerText(engine);
  const skill = engine ? skillLine(engine, target.label) : null;
  const mirror = engine ? mirrorLine(engine) : null;
  const exact = mirrorExact(engine);
  const blank = status === "loading" || status === "error";
  const dash = (value) => (engine ? value : "—");
  const showMirrorSlot = engine ? Boolean(exact) : assetKey === "sp500";

  return (
    <>
      {/* On large screens the answer and its lines share one reserved height
          (the S&P 500's three-line answer and four lines): a shorter answer
          keeps its lines right under it, and the spare room falls below. */}
      <div className="mt-3 grid gap-4 lg:min-h-[13.5rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-2.5">
        <h2
          id="peek-future-title"
          ref={titleRef}
          tabIndex={-1}
          className={`min-h-[8rem] max-w-[40rem] text-balance text-2xl font-semibold tracking-[-0.04em] focus:outline-none min-[390px]:min-h-[6rem] sm:min-h-[6.75rem] sm:text-3xl lg:col-start-1 lg:row-start-1 lg:min-h-0 ${
            status === "error"
              ? "text-(--sh-text-3)"
              : "text-[#14121a] dark:text-[#f2ede4]"
          }`}
        >
          {status === "error" ? (
            "Archive unavailable"
          ) : answer ? (
            answer
          ) : (
            <>
              <span className="sr-only">Reading archive</span>
              <span className="block space-y-[0.25em] pt-[0.1em]" aria-hidden="true">
                <span className="block h-[0.9em] w-[88%] animate-pulse rounded-lg bg-black/[0.06] dark:bg-white/[0.06]" />
                <span className="block h-[0.9em] w-[64%] animate-pulse rounded-lg bg-black/[0.06] dark:bg-white/[0.06]" />
              </span>
            </>
          )}
        </h2>

        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {engine && !outlook ? null : (
            <table className="w-full border-collapse">
              <caption className="sr-only">
                These {k} setups compared with all years since {since}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="pb-1.5 text-left align-bottom">
                    <span className="sr-only">Measure</span>
                  </th>
                  <th
                    scope="col"
                    className="whitespace-nowrap pb-1.5 pl-3 text-right align-bottom text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)"
                  >
                    These {k}
                  </th>
                  <th
                    scope="col"
                    className="max-w-[8.5rem] pb-1.5 pl-3 text-right align-bottom text-micro font-medium uppercase leading-snug tracking-[0.14em] text-(--sh-text-3)"
                  >
                    All years since {since}
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Higher a year later",
                    twelve ? `${twelve.higher} of ${twelve.of}` : null,
                    formatShare(twelve?.base_share_up_pct),
                  ],
                  [
                    "Median change",
                    formatChange(twelve?.median_return_pct),
                    formatChange(twelve?.base_median_return_pct),
                  ],
                  [
                    "Fell 20% or more within the year",
                    drawdown ? `${drawdown.fell_20} of ${drawdown.of}` : null,
                    formatShare(drawdown?.base_share_20_pct),
                  ],
                ].map(([label, these, usual]) => (
                  <tr key={label} className="border-t border-(--sh-line-1)">
                    <th
                      scope="row"
                      className="py-2 pr-2 text-left text-meta font-normal text-(--sh-text-2) text-balance"
                    >
                      {label}
                    </th>
                    <td className="whitespace-nowrap py-2 pl-3 text-right font-mono text-strong tabular-nums text-(--sh-text-1)">
                      {dash(these ?? "—")}
                    </td>
                    <td className="whitespace-nowrap py-2 pl-3 text-right font-mono text-meta tabular-nums text-(--sh-text-3)">
                      {dash(usual)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Remounted with its content: on large screens it sits right under
            the answer, so a two-line answer moves it up. New nodes are a
            content swap, not a layout shift. */}
        <div
          key={`${blank}|${answer}|${skill}|${mirror}`}
          className="grid min-h-[7.75rem] max-w-[36rem] content-start gap-1.5 text-balance text-meta leading-relaxed text-(--sh-text-2) min-[390px]:min-h-[6.5rem] sm:min-h-[5.75rem] sm:text-body lg:col-start-1 lg:row-start-2 lg:min-h-0"
        >
          {blank || !engine ? (
            <p className="text-(--sh-text-3)">—</p>
          ) : (
            <>
              {skill ? <p>{skill}</p> : null}
              {mirror ? (
                <p>
                  <span
                    className="mr-2 inline-block w-3.5 -translate-y-[3px] border-t-2 border-[#a16207] dark:border-[#d8b47a]"
                    aria-hidden="true"
                  />
                  {mirror}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div
        className="mt-6 rounded-[1.6rem] border border-(--sh-line-1) bg-white/45 p-4 [--fan-accent:var(--fan-accent-light)] [--fan-gold:#a16207] [--fan-ink:#14121a] [--fan-surface:#f3eee6] dark:bg-black/40 dark:[--fan-accent:var(--fan-accent-dark)] dark:[--fan-gold:#d8b47a] dark:[--fan-ink:#f2ede4] dark:[--fan-surface:#0b0b12] sm:px-6 sm:py-5 lg:mt-4 lg:py-4"
        style={{ "--fan-accent-light": target.light, "--fan-accent-dark": target.dark }}
      >
        <div
          className={`flex flex-wrap gap-x-4 gap-y-1 text-micro text-(--sh-text-3) ${
            engine ? "" : "invisible"
          }`}
          aria-hidden="true"
        >
          <span className="inline-flex items-center gap-1.5">
            <LegendKey className="border-(--fan-accent)" />
            Today’s 12 months
          </span>
          {outlook || !engine ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <LegendKey className="border-dashed border-(--fan-accent)" />
                Median of the {k} setups
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i className="inline-block h-2 w-4 rounded-[2px] bg-(--fan-ink)/10" />
                Usual middle half
              </span>
              <span className="inline-flex items-center gap-1.5">
                <LegendKey className="border-dotted border-(--sh-text-2)" />
                Usual
              </span>
            </>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block w-4 border-t border-(--fan-ink)/35" aria-hidden="true" />
            {setupsLabel(k)}
          </span>
          {/* Kept in the flow without a mirror, so the legend wraps alike. */}
          <span
            className={`inline-flex items-center gap-1.5 ${
              showMirrorSlot && (!engine || exact) ? "" : "invisible"
            }`}
          >
            <LegendKey className="border-(--fan-gold)" />
            120 years ago
          </span>
        </div>

        {mounted ? (
          <Suspense fallback={<InstrumentPlaceholder />}>
            <AnalogInstrument
              engine={blank ? null : engine}
              status={status}
              assetKey={assetKey}
              assetLabel={target.label}
              isDark={isDark}
            />
          </Suspense>
        ) : (
          <InstrumentPlaceholder />
        )}
      </div>

      <p className="mt-5 border-t border-(--sh-line-1) pt-3.5 text-micro leading-relaxed text-(--sh-text-3)">
        These are historical events, not predictions for today. This is a
        historical echo of what followed a similar market setup. It is
        descriptive research, not a forecast or investment advice.
      </p>
    </>
  );
}
