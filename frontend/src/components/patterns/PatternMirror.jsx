"use client";

import { lazy, memo, Suspense } from "react";
import {
  closerThan,
  firstEvent,
  formatChange,
  formatCount,
  formatDate,
  formatMonth,
  mirrorExact,
  mirrorNoInformation,
} from "@/components/patterns/patternFormat";
import { ASSET_TARGETS } from "@/components/regime/assetTargets";

function ordinal(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return "—";
  const tens = number % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? "th"
      : { 1: "st", 2: "nd", 3: "rd" }[number % 10] ?? "th";
  return `${number}${suffix}`;
}

/** A closed-by-default native disclosure row (section 02 and Evidence). */
export function DisclosureRow({ label, meta, metaLong, children }) {
  return (
    <details className="group border-t border-(--sh-line-1)">
      <summary className="group/summary flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-xl px-1 [&::-webkit-details-marker]:hidden">
        <span className="text-micro font-medium uppercase tracking-[0.16em] text-(--sh-text-3) transition-colors duration-(--sh-dur-micro) group-hover/summary:text-(--sh-text-1) group-focus-visible/summary:text-(--sh-text-1) motion-reduce:transition-none">
          {label}
        </span>
        <span className="ml-auto flex items-center gap-3">
          {meta || metaLong ? (
            <span className="text-right font-mono text-micro text-(--sh-text-3)">
              {metaLong ? (
                <span className="max-sm:hidden">
                  {metaLong}
                  {meta ? " · " : ""}
                </span>
              ) : null}
              {meta}
            </span>
          ) : null}
          <span
            className="text-base leading-none text-(--sh-text-3) transition-transform duration-(--sh-dur-micro) group-open:rotate-45 motion-reduce:transition-none"
            aria-hidden="true"
          >
            +
          </span>
        </span>
      </summary>
      <div className="pb-5 pt-1">{children}</div>
    </details>
  );
}

function Fact({ label, value, words = false, detail, swatch = false }) {
  return (
    <div className="grid gap-x-6 gap-y-1 border-t border-(--sh-line-1) py-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      <p className="flex items-center gap-2 text-meta text-(--sh-text-2)">
        {swatch ? (
          <span
            className="inline-block w-3 border-t-2 border-[#a16207] dark:border-[#d8b47a]"
            aria-hidden="true"
          />
        ) : null}
        {label}
      </p>
      <div>
        <p
          className={
            words
              ? "text-body text-(--sh-text-1)"
              : "font-mono text-strong tabular-nums text-(--sh-text-1)"
          }
        >
          {value}
        </p>
        {detail ? (
          <p className="mt-0.5 text-micro leading-relaxed text-(--sh-text-3)">{detail}</p>
        ) : null}
      </div>
    </div>
  );
}

// The bodies of this section's two closed disclosures are code-split (they
// live in PatternEvidence.jsx) and render inside closed <details>, so nothing
// moves when they arrive. The static Geopolitics editorial is in the server
// HTML; "{n} moments" comes with the data, so only the client renders it.
const MirrorMoments = lazy(() =>
  import("@/components/patterns/PatternEvidence").then((mod) => ({ default: mod.MirrorMoments })),
);
const GeopoliticsBody = lazy(() =>
  import("@/components/patterns/PatternEvidence").then((mod) => ({ default: mod.GeopoliticsBody })),
);

// Memoised on `asset` alone (the body picks its own theme colour): the page's
// re-renders after hydration never reach this server-rendered boundary before
// its code arrives, so React hydrates the server HTML instead of replacing it.
const Geopolitics = memo(function Geopolitics({ asset }) {
  return (
    <DisclosureRow label="Geopolitics & science" meta={`2026 · ${asset === "nifty" ? "2008" : "1906"}`}>
      <Suspense fallback={null}>
        <GeopoliticsBody asset={asset} />
      </Suspense>
    </DisclosureRow>
  );
});

/**
 * Section 02: the 120-year mirror in detail, with "5 moments" and
 * "Geopolitics & science" closed until asked for. Assets without 120 years of
 * history say so, with a way to the S&P 500 mirror.
 */
export function PatternMirror({ engine, assetKey, onOpenMirror }) {
  const asset = ASSET_TARGETS[engine?.asset] ? engine.asset : assetKey;
  const label = (ASSET_TARGETS[asset] ?? ASSET_TARGETS.sp500).label;
  const exact = mirrorExact(engine);
  const hasMirror = engine ? Boolean(exact) : asset === "sp500";
  const evidence = mirrorNoInformation(engine);
  const aligned = engine?.mirror?.available === true ? engine.mirror.aligned : null;
  const events = [...(exact?.events ?? [])].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
  const followed = firstEvent(exact?.events);
  const band = Array.isArray(aligned?.band_years) ? aligned.band_years : [110, 130];

  return (
    <div className="mt-3 overflow-hidden rounded-[1.6rem] border border-(--sh-line-1) bg-white/45 p-5 dark:bg-black/40 sm:p-8">
      <div className="grid gap-8 lg:grid-cols-[0.62fr_1.38fr] lg:items-start">
        <div className="lg:self-stretch lg:border-r lg:border-(--sh-line-1) lg:pr-10">
          <p className="text-micro font-medium uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
            Structural echo
          </p>
          {hasMirror ? (
            <>
              <div className="mt-2 flex items-end gap-2">
                <span className="font-mono text-[5rem] font-medium leading-[0.72] tracking-[-0.08em] text-[#14121a] dark:text-[#f2ede4] sm:text-[6rem]">
                  120
                </span>
                <span className="pb-2 text-micro uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
                  years
                </span>
              </div>
              <p className="mt-3 max-w-xs text-meta leading-relaxed text-black/70 dark:text-white/70">
                The century repeats in structure: a new technology, a credit
                cycle, and a contest for power.
              </p>
            </>
          ) : (
            <>
              <p className="mt-3.5 max-w-[20rem] text-strong leading-normal text-(--sh-text-1)">
                No 120-year mirror: {label} history begins on{" "}
                {engine ? formatDate(engine.history_start) : "—"}.
              </p>
              <button
                type="button"
                onClick={onOpenMirror}
                className="mt-3 inline-flex min-h-11 items-center rounded-full border border-(--sh-line-2) px-3.5 text-micro font-medium text-(--sh-text-2) transition-colors duration-(--sh-dur-micro) hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) focus-visible:text-(--sh-text-1) motion-reduce:transition-none"
              >
                Open the S&amp;P 500 mirror
              </button>
            </>
          )}
        </div>

        <div className="min-w-0">
          <h2 className="text-pretty text-2xl font-semibold tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl">
            History does not repeat. It rhymes.
          </h2>
          {hasMirror ? (
            <div className="mt-5">
              <Fact
                swatch
                label="Exactly 120 years ago"
                value={
                  exact
                    ? `${formatMonth(exact.window?.start)} – ${formatMonth(exact.window?.end)}`
                    : "—"
                }
                detail={
                  exact
                    ? `closer than ${closerThan(exact.closer_than_pct)} of past 12-month windows`
                    : null
                }
              />
              <Fact
                label="What followed"
                value={exact ? formatChange(exact.forward?.return_12m_pct) : "—"}
                detail={followed ? `${followed.title}, ${formatDate(followed.date)}` : null}
              />
              {evidence ? (
                <Fact
                  label="The 120-year offset, tested"
                  value="No better than chance"
                  words
                  detail={`average rank ${ordinal(evidence.mean_rank_pct)} percentile in ${formatCount(evidence.months_tested)} monthly tests (chance: ${ordinal(evidence.chance_rank_pct)})`}
                />
              ) : null}
              {aligned ? (
                <Fact
                  label={`Best match ${band[0]}–${band[1]} years back`}
                  value={`${formatMonth(aligned.window?.start)} – ${formatMonth(aligned.window?.end)}`}
                  detail={`${Number(aligned.offset_years).toFixed(1)} years back · the best of ${formatCount(aligned.windows_in_band)} windows, so a close match is no surprise`}
                />
              ) : null}
            </div>
          ) : null}
          <div className={hasMirror ? "" : "mt-5"}>
            {events.length > 0 ? (
              <DisclosureRow
                label={`${events.length} moments`}
                meta={`${formatMonth(events[0].date)} – ${formatMonth(events[events.length - 1].date)}`}
              >
                <Suspense fallback={null}>
                  <MirrorMoments events={events} />
                </Suspense>
              </DisclosureRow>
            ) : null}
            <Geopolitics asset={asset} />
          </div>
        </div>
      </div>
      <p className="mt-6 border-t border-black/5 pt-4 text-micro leading-relaxed text-black/60 dark:border-white/5 dark:text-white/60">
        The Repeatability Index is an editorial analogy, not a statistical
        forecast. A high price correlation is a descriptive echo, not a
        guarantee of the next move.
      </p>
    </div>
  );
}
