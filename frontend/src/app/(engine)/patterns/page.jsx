"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { PeekIntoFuture } from "@/components/patterns/PeekIntoFuture";
import { PatternEraPanel } from "@/components/patterns/PatternEraPanel";
import { PatternMarketCard } from "@/components/patterns/PatternMarketCard";
import { SimilarityBadge } from "@/components/patterns/SimilarityBadge";
import {
  PATTERN_ASSET_ORDER,
  ASSET_TARGETS,
  assetChartColor,
} from "@/components/regime/assetTargets";
import { formatDate } from "@/components/regime/regimeUtils";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function SectionLabel({ number, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-micro text-[#c0442f] dark:text-[#ff8b77]">
        {number}
      </span>
      <span className="h-px w-8 bg-black/10 dark:bg-white/15" aria-hidden="true" />
      <p className="text-micro font-medium uppercase tracking-[0.18em] text-black/60 dark:text-white/60">
        {children}
      </p>
    </div>
  );
}

function MarketSkeleton() {
  return (
    <div className="h-[480px] animate-pulse rounded-[1.6rem] border border-black/5 bg-white/35 dark:border-white/5 dark:bg-black/30" />
  );
}

function toTimeline(window) {
  if (!window || !Array.isArray(window.series)) return [];
  return window.series.map((point) => ({
    date: point.date,
    sp500_proxy: point.value,
  }));
}

function toSummary(window) {
  if (!window) return null;
  return {
    ...window,
    change: window.return_pct,
    drawdown: window.drawdown_pct,
    coreIndex: window.core_index,
    coreBucket: window.core_index_bucket,
  };
}

function similarityMeta(score, isDark) {
  if (score == null) {
    return {
      label: "Reading echo",
      color: null,
    };
  }
  if (score > 80) {
    return {
      label: "Strong echo",
      color: isDark ? "#34d399" : "#047857",
    };
  }
  if (score >= 50) {
    return {
      label: "Partial echo",
      color: isDark ? "#e2e8f0" : "#475569",
    };
  }
  return {
    label: "Weak echo",
    color: isDark ? "#fb7185" : "#c0442f",
  };
}

function AssetLens({ assetKey, onChange }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
        Market lens
      </span>
      <div
        role="group"
        aria-label="Pattern market lens"
        className="inline-flex items-center gap-0.5 rounded-full border border-black/5 bg-black/[0.025] p-0.5 dark:border-white/5 dark:bg-white/[0.035]"
      >
        {PATTERN_ASSET_ORDER.map((key) => {
          const target = ASSET_TARGETS[key];
          const selected = key === assetKey;
          // Both theme colours ride on CSS variables so the server markup is
          // theme-agnostic; the .dark class picks the pair, never JS.
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={selected}
              className={`rounded-full px-3 py-1.5 text-micro font-medium transition-colors ${
                selected
                  ? "bg-white/80 text-(--lens-light) dark:bg-(--lens-dark)/12 dark:text-(--lens-dark)"
                  : "text-black/60 hover:text-black/75 focus-visible:text-black/75 dark:text-white/60 dark:hover:text-white/75 dark:focus-visible:text-white/75"
              }`}
              style={
                selected
                  ? { "--lens-light": target.light, "--lens-dark": target.dark }
                  : undefined
              }
            >
              {target.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function PatternsPage() {
  const { resolvedTheme } = useTheme();
  // false during SSR/hydration, true after: the server cannot know the theme, so
  // JS-computed colours switch to the resolved theme only once mounted.
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const isDark = !mounted || resolvedTheme !== "light";
  const marketsHeadingRef = useRef(null);
  const [assetKey, setAssetKey] = useState("sp500");
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/v1/patterns?asset=${encodeURIComponent(assetKey)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.detail ||
              payload?.error ||
              `Pattern archive returned ${response.status}.`,
          );
        }
        return response.json();
      })
      .then((payload) => {
        if (!payload?.current || !payload?.forward) {
          throw new Error("The pattern archive returned an unexpected payload.");
        }
        setState({ status: "ready", data: payload, error: null });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setState({ status: "error", data: null, error: error.message });
        }
      });

    return () => controller.abort();
  }, [assetKey, reloadKey]);

  const handleAssetChange = (key) => {
    if (key === assetKey) return;
    setState({ status: "loading", data: null, error: null });
    setAssetKey(key);
  };

  const handleRetry = () => {
    // The alert (and this button) unmount on retry; keep focus in the section.
    marketsHeadingRef.current?.focus({ preventScroll: true });
    setState({ status: "loading", data: null, error: null });
    setReloadKey((key) => key + 1);
  };

  const data = state.data;
  const asset = ASSET_TARGETS[assetKey] ?? ASSET_TARGETS.sp500;
  const accent = assetChartColor(asset, isDark);
  const fallback = Boolean(data?.mirror_fallback);
  const nowTimeline = toTimeline(data?.current);
  const thenTimeline = toTimeline(data?.historical);
  const nowSummary = toSummary(data?.current);
  const thenSummary = toSummary(data?.historical);
  const nowDate = data?.current?.end ?? null;
  const thenDate = data?.historical_date ?? null;
  const thenLabel = fallback
    ? "Closest available mirror"
    : "Exactly 120 years ago";
  const thenContext = fallback
    ? data?.mirror_note ??
      "The asset does not reach back 120 years; the earliest complete one-year mirror is used."
    : "Railroads, electricity and the road to 1907";
  const echo = similarityMeta(data?.similarity_percentage, isDark);
  const echoLabel = fallback
    ? "Short-history lens"
    : state.status === "error"
      ? "Unavailable"
      : echo.label;
  const pendingDate =
    state.status === "error" ? "Archive unavailable" : "Loading archive…";

  return (
    <main className="relative h-full w-full overflow-y-auto overflow-x-hidden pb-24 pt-3 sm:pt-4">
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8">
        <header className="flex flex-col gap-4 pr-14 sm:pr-16 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-micro uppercase tracking-[0.2em] text-[#c0442f] dark:text-[#ff8b77]">
              Study of Patterns
            </p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl lg:text-6xl">
              {assetKey === "nifty"
                ? "The Indian market mirror."
                : "The 120-year mirror."}
            </h1>
            <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/70 dark:text-white/70 sm:text-body">
              A rolling comparison of two market windows, the correlation
              between them, and exactly what happened in the historical year
              that followed. Different technology, different headlines,
              familiar human mechanics.
            </p>
            <AssetLens
              assetKey={assetKey}
              onChange={handleAssetChange}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/45 px-3 py-1.5 text-micro font-medium uppercase tracking-[0.12em] text-black/60 backdrop-blur-2xl dark:border-white/5 dark:bg-black/30 dark:text-white/60">
              <span
                className="h-1.5 w-1.5 rounded-full bg-[#0f766e] dark:bg-[#5eead4]"
                aria-hidden="true"
              />
              {fallback ? "Earliest mirror" : "120-year study"}
            </span>
            <span className="inline-flex items-center rounded-full border border-black/5 bg-white/35 px-3 py-1.5 text-micro text-black/60 backdrop-blur-2xl dark:border-white/5 dark:bg-black/25 dark:text-white/60">
              {nowDate ? formatDate(nowDate) : "—"} ·{" "}
              {thenDate ? formatDate(thenDate) : "—"}
            </span>
          </div>
        </header>

        <section className="mt-5 overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/40 p-4 backdrop-blur-2xl dark:border-white/5 dark:bg-black/30 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div className="rounded-2xl border border-black/5 bg-white/45 px-4 py-3 dark:border-white/5 dark:bg-white/[0.03]">
              <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
                Today
              </p>
              <p className="mt-1 font-mono text-lg font-medium tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
                {nowDate ? formatDate(nowDate) : pendingDate}
              </p>
              <p className="mt-0.5 text-micro text-black/60 dark:text-white/60">
                {assetKey === "nifty"
                  ? "Domestic flows, earnings and a valuation reset"
                  : "AI, ETFs and concentrated leadership"}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 py-1 sm:flex-col">
              <span className="h-px w-10 bg-black/10 sm:h-8 sm:w-px dark:bg-white/15" />
              <span className="whitespace-nowrap font-mono text-micro uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
                {fallback ? `${asset.label} mirror` : "120 years"}
              </span>
              <span className="h-px w-10 bg-black/10 sm:h-8 sm:w-px dark:bg-white/15" />
            </div>
            <div className="rounded-2xl border border-black/5 bg-white/45 px-4 py-3 dark:border-white/5 dark:bg-white/[0.03]">
              <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
                {thenLabel}
              </p>
              <p className="mt-1 font-mono text-lg font-medium tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
                {thenDate ? formatDate(thenDate) : pendingDate}
              </p>
              <p className="mt-0.5 text-micro text-black/60 dark:text-white/60">
                {thenContext}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <SectionLabel number="01">Markets · then vs now</SectionLabel>
          <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <h2
              ref={marketsHeadingRef}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-[-0.04em] text-[#14121a] focus:outline-none dark:text-[#f2ede4] sm:text-3xl"
            >
              The same market animal.
            </h2>
            <p className="max-w-xl text-micro leading-relaxed text-black/60 dark:text-white/60">
              {fallback
                ? `The closest available ${asset.label} mirror is used because the index does not reach back 120 years. The historical forward tape is still real.`
                : "A century apart, both markets were near highs, calm on the surface, and leaning on a powerful new technology story."}
            </p>
          </div>

          {state.status === "error" ? (
            <div
              role="alert"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ef4444]/25 bg-[#ef4444]/4 px-4 py-3"
            >
              <p className="text-micro text-[#c0442f] dark:text-[#ff8b77]">
                Pattern archive unavailable: {state.error}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="shrink-0 rounded-full border border-black/14 px-3.5 py-1.5 text-micro font-medium text-black/70 transition-colors hover:bg-black/4 focus-visible:bg-black/4 pointer-coarse:min-h-11 dark:border-white/14 dark:text-white/70 dark:hover:bg-white/6 dark:focus-visible:bg-white/6"
              >
                Retry
              </button>
            </div>
          ) : null}

          <div className="mt-4 grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
            {state.status === "loading" ? (
              <>
                <MarketSkeleton />
                <div className="hidden lg:block">
                  <div className="h-32 w-40 animate-pulse rounded-2xl bg-black/[0.04] dark:bg-white/[0.05]" />
                </div>
                <MarketSkeleton />
              </>
            ) : (
              <>
                <PatternMarketCard
                  side="Now"
                  date={nowDate}
                  label={
                    assetKey === "nifty"
                      ? "A valuation reset"
                      : "A concentrated expansion"
                  }
                  timeline={nowTimeline}
                  summary={nowSummary}
                  isDark={isDark}
                  accent={accent}
                  editorial={
                    assetKey === "nifty"
                      ? "India's benchmark is digesting a valuation reset while domestic flows and earnings growth provide support. The concentration is in large caps and financials; the risk is the global funding cycle."
                      : "AI infrastructure, ETF flows and a narrow mega-cap leadership group carry the index near record levels. The surface is calm; the concentration is the story."
                  }
                />
                <SimilarityBadge
                  score={data?.similarity_percentage}
                  isDark={isDark}
                  status={state.status}
                />
                <PatternMarketCard
                  side="Then"
                  date={thenDate}
                  label={fallback ? "The 2008 global crisis" : "The calm before 1907"}
                  timeline={thenTimeline}
                  summary={thenSummary}
                  isDark={isDark}
                  accent={accent}
                  editorial={
                    fallback && assetKey === "nifty"
                      ? "The Nifty's earliest complete one-year mirror captures the 2008 global crisis: Lehman, the Mumbai attacks and the Satyam accounting shock. India was not insulated from a global funding squeeze."
                      : "Railroads, electrification and trust consolidation were the growth story. The Panic of 1907 was still about a year away; the surface was calm then, too."
                  }
                />
              </>
            )}
          </div>
          {fallback && data?.mirror_note ? (
            <p className="mt-2 text-micro leading-relaxed text-black/60 dark:text-white/60">
              {data.mirror_note}
            </p>
          ) : null}

          {state.status === "ready" && data ? (
            <PeekIntoFuture
              forward={data.forward}
              assetLabel={data.asset_label ?? asset.label}
              isDark={isDark}
              accent={accent}
            />
          ) : null}
        </section>

        <section className="mt-10">
          <SectionLabel number="02">Geopolitics &amp; science</SectionLabel>
          <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl">
              Different tools, familiar tensions.
            </h2>
            <p className="max-w-xl text-micro leading-relaxed text-black/60 dark:text-white/60">
              A general-purpose technology, a contested chokepoint, and a
              political order under strain. The nouns change; the grammar
              repeats.
            </p>
          </div>

          <div className="mt-4 grid items-stretch gap-4 lg:grid-cols-2">
            <PatternEraPanel
              side="Now"
              era="2026"
              title="AI, security and the new industrial race"
              summary="The general-purpose technology is AI. The contested chokepoint is compute, energy and the supply chain that makes both possible."
              bullets={[
                "AI infrastructure and data-centre capex become strategic assets.",
                "US–China technology competition redraws trade and alliance maps.",
                "European security and energy transition compete for fiscal space.",
                "A concentrated market leadership group becomes a political actor.",
              ]}
              accent={accent}
              isDark={isDark}
            />
            {fallback && assetKey === "nifty" ? (
              <PatternEraPanel
                side="Then"
                era="2008"
                title="Lehman, Mumbai and the Satyam shock"
                summary="A global funding crisis met a domestic security shock and a corporate-governance failure. The Indian market had to reprice all three at once."
                bullets={[
                  "Lehman Brothers collapses in September 2008 and global credit freezes.",
                  "The Mumbai attacks of November 2008 raise sovereign and security risk.",
                  "Satyam's accounting fraud tests confidence in Indian corporate governance.",
                  "The 2009 election result becomes a political-risk release valve.",
                ]}
                accent={accent}
                isDark={isDark}
              />
            ) : (
              <PatternEraPanel
                side="Then"
                era="1906"
                title="Earthquake, dreadnoughts and electricity"
                summary="The general-purpose technology was electricity. The contested chokepoint was rail, coal and the coaling stations that connected empires."
                bullets={[
                  "The San Francisco earthquake (April 1906) exposes infrastructure fragility.",
                  "HMS Dreadnought resets the naval arms race in 1906.",
                  "The Anglo-Russian Entente rearranges the great-power map.",
                  "Rapid industrialisation and trust consolidation set up the Panic of 1907.",
                ]}
                accent={accent}
                isDark={isDark}
              />
            )}
          </div>
        </section>

        <section className="mt-10">
          <SectionLabel number="03">Repeatability index</SectionLabel>
          <div className="mt-3 overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/45 p-5 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-2xl dark:border-white/5 dark:bg-black/40 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)] sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
              <div className="relative border-black/5 lg:border-r lg:pr-8 dark:border-white/10">
                <p className="text-micro font-medium uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
                  Structural echo
                </p>
                <div className="mt-2 flex items-end gap-2">
                  <span className="font-mono text-[5rem] font-medium leading-[0.72] tracking-[-0.08em] text-[#14121a] dark:text-[#f2ede4] sm:text-[6rem]">
                    {fallback ? "1Y" : "120"}
                  </span>
                  <span className="pb-2 text-micro uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
                    {fallback ? "mirror" : "years"}
                  </span>
                </div>
                <p className="mt-3 max-w-xs text-meta leading-relaxed text-black/70 dark:text-white/70">
                  {fallback
                    ? `The ${asset.label} lens uses its earliest complete one-year window. The pattern still rhymes: emotion, leverage and a technology story.`
                    : "The century repeats in structure: a new technology, a credit cycle, and a contest for power."}
                </p>
                <span
                  className={`mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-micro font-medium ${
                    echo.color
                      ? "bg-white/80 dark:bg-(--echo-tint)"
                      : "border-black/14 text-black/60 dark:border-white/14 dark:text-white/60"
                  }`}
                  style={
                    echo.color
                      ? {
                          borderColor: `${echo.color}33`,
                          "--echo-tint": `${echo.color}16`,
                          color: echo.color,
                        }
                      : undefined
                  }
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {echoLabel}
                </span>
              </div>

              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl">
                  History does not repeat. It rhymes.
                </h2>
                <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/70 dark:text-white/70">
                  Human emotion, debt and technological booms are the
                  constants. The 1906 boom in rails and electricity, the 2008
                  credit shock and the 2026 boom in AI and compute are different
                  expressions of the same sequence: a general-purpose technology
                  attracts capital, leverage amplifies the build-out, and the
                  bill arrives when the story stops compounding.
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  {[
                    ["Emotion", "Fear and greed do not update with the technology."],
                    ["Debt", "Every boom finds a new way to borrow against the future."],
                    ["Technology", "A general-purpose tool attracts capital, then overcapacity."],
                    ["Power", "Geopolitical competition follows the money and the chokepoint."],
                  ].map(([label, text]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.03]"
                    >
                      <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
                        {label}
                      </p>
                      <p className="mt-1 text-micro leading-relaxed text-black/70 dark:text-white/70">
                        {text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-6 border-t border-black/5 pt-4 text-micro leading-relaxed text-black/60 dark:border-white/5 dark:text-white/60">
              The Repeatability Index is an editorial analogy, not a
              statistical forecast. A high price correlation is a descriptive
              echo, not a guarantee of the next move.
            </p>
          </div>
        </section>

        <div className="mt-6 flex flex-col gap-3 border-t border-black/5 pt-4 text-micro text-black/60 dark:border-white/5 dark:text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Study of Patterns · {asset.label} lens · data from the StrikeHike
            macro archive
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/regime"
              className="text-black/70 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#c0442f] focus-visible:text-[#c0442f] dark:text-white/70 dark:decoration-white/20 dark:hover:text-[#ff8b77] dark:focus-visible:text-[#ff8b77]"
            >
              Open the Core Index atlas
            </Link>
            <Link
              href="/convergence"
              className="text-black/70 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#c0442f] focus-visible:text-[#c0442f] dark:text-white/70 dark:decoration-white/20 dark:hover:text-[#ff8b77] dark:focus-visible:text-[#ff8b77]"
            >
              Compare two events
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
