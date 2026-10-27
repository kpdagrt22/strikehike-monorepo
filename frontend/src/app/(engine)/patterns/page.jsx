"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { PatternEraPanel } from "@/components/patterns/PatternEraPanel";
import { PatternMarketCard } from "@/components/patterns/PatternMarketCard";
import {
  addDaysIso,
  formatDate,
} from "@/components/regime/regimeUtils";

const TODAY = "2026-10-26";
const PAST = "1906-10-26";
const TODAY_START = addDaysIso(TODAY, -365);
const PAST_START = addDaysIso(PAST, -365);

function marketSummary(timeline) {
  if (!Array.isArray(timeline)) return null;
  const points = timeline
    .map((point) => ({
      ...point,
      value: Number(point.sp500_proxy),
    }))
    .filter((point) => Number.isFinite(point.value) && point.value > 0);
  if (points.length === 0) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const change = first.value > 0 ? (last.value / first.value - 1) * 100 : null;
  const drawdown =
    last.drawdown_1y == null ? null : Number(last.drawdown_1y);
  const phase = last.phase ?? "—";
  let state = "Stable";
  if (phase === "recession" || (drawdown != null && drawdown <= -15)) {
    state = "Contraction";
  } else if (change != null && change > 20) {
    state = "Strong expansion";
  } else if (change != null && change > 3) {
    state = "Expansion";
  } else if (change != null && change < -3) {
    state = "Contraction";
  }

  return {
    level: last.value,
    source:
      last.proxy_source === "SP500"
        ? "S&P 500"
        : last.proxy_source === "M1125AUSM343NNBR"
          ? "Cowles / S&P common stock index"
          : last.proxy_source ?? "Long-run equity proxy",
    change,
    drawdown,
    phase: phase === "recession" ? "Recession" : "Expansion",
    state,
    coreIndex:
      last.core_index == null ? null : Number(last.core_index),
    coreBucket: last.core_index_bucket ?? null,
  };
}

function SectionLabel({ number, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] text-[#c0442f] dark:text-[#ff8b77]">
        {number}
      </span>
      <span className="h-px w-8 bg-black/10 dark:bg-white/15" aria-hidden="true" />
      <p className="text-micro font-medium uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
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

export default function PatternsPage() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const [state, setState] = useState({
    status: "loading",
    now: [],
    past: [],
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function fetchWindow(start, end) {
      const response = await fetch(
        `/api/v1/regime/macro-history?resolution=daily&start=${start}&end=${end}`,
        { signal: controller.signal, cache: "no-store" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          payload?.detail ||
            payload?.error ||
            `Market archive returned ${response.status}.`,
        );
      }
      const payload = await response.json();
      return Array.isArray(payload?.timeline) ? payload.timeline : [];
    }

    Promise.all([
      fetchWindow(TODAY_START, TODAY),
      fetchWindow(PAST_START, PAST),
    ])
      .then(([now, past]) => {
        setState({ status: "ready", now, past, error: null });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setState({
            status: "error",
            now: [],
            past: [],
            error: error.message,
          });
        }
      });

    return () => controller.abort();
  }, []);

  const nowSummary = useMemo(() => marketSummary(state.now), [state.now]);
  const pastSummary = useMemo(() => marketSummary(state.past), [state.past]);
  const nowAccent = isDark ? "#67e8f9" : "#0e7490";
  const pastAccent = isDark ? "#facc15" : "#a16207";

  return (
    <main className="relative h-full w-full overflow-y-auto overflow-x-hidden pb-24 pt-20 sm:pt-24">
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-micro uppercase tracking-[0.2em] text-[#c0442f] dark:text-[#ff8b77]">
              Study of Patterns
            </p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl lg:text-6xl">
              The 120-year mirror.
            </h1>
            <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/55 dark:text-white/55 sm:text-body">
              Today and exactly 120 years ago. Different technology, different
              headlines, familiar human mechanics. A magazine-style comparison
              of markets, geopolitics and the patterns that rhyme.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/45 px-3 py-1.5 text-micro font-medium uppercase tracking-[0.12em] text-black/55 backdrop-blur-2xl dark:border-white/5 dark:bg-black/30 dark:text-white/55">
              <span
                className="h-1.5 w-1.5 rounded-full bg-[#0f766e] dark:bg-[#5eead4]"
                aria-hidden="true"
              />
              120-year study
            </span>
            <span className="inline-flex items-center rounded-full border border-black/5 bg-white/35 px-3 py-1.5 text-micro text-black/45 backdrop-blur-2xl dark:border-white/5 dark:bg-black/25 dark:text-white/45">
              {formatDate(TODAY)} · {formatDate(PAST)}
            </span>
          </div>
        </header>

        <section className="mt-5 overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/40 p-4 backdrop-blur-2xl dark:border-white/5 dark:bg-black/30 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <div className="rounded-2xl border border-black/5 bg-white/45 px-4 py-3 dark:border-white/5 dark:bg-white/[0.03]">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-black/35 dark:text-white/35">
                Today
              </p>
              <p className="mt-1 font-mono text-lg font-medium tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
                {formatDate(TODAY)}
              </p>
              <p className="mt-0.5 text-micro text-black/40 dark:text-white/40">
                AI, ETFs and concentrated leadership
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 py-1 sm:flex-col">
              <span className="h-px w-10 bg-black/10 sm:h-8 sm:w-px dark:bg-white/15" />
              <span className="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
                120 years
              </span>
              <span className="h-px w-10 bg-black/10 sm:h-8 sm:w-px dark:bg-white/15" />
            </div>
            <div className="rounded-2xl border border-black/5 bg-white/45 px-4 py-3 dark:border-white/5 dark:bg-white/[0.03]">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-black/35 dark:text-white/35">
                Exactly 120 years ago
              </p>
              <p className="mt-1 font-mono text-lg font-medium tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
                {formatDate(PAST)}
              </p>
              <p className="mt-0.5 text-micro text-black/40 dark:text-white/40">
                Railroads, electricity and the road to 1907
              </p>
            </div>
          </div>
        </section>

        <section className="mt-8">
          <SectionLabel number="01">Markets · then vs now</SectionLabel>
          <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl">
              The same market animal.
            </h2>
            <p className="max-w-xl text-micro leading-relaxed text-black/45 dark:text-white/45">
              A century apart, both markets were near highs, calm on the
              surface, and leaning on a powerful new technology story.
            </p>
          </div>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
            {state.status === "loading" ? (
              <>
                <MarketSkeleton />
                <MarketSkeleton />
              </>
            ) : (
              <>
                <PatternMarketCard
                  side="Now"
                  date={TODAY}
                  label="A concentrated expansion"
                  timeline={state.now}
                  summary={nowSummary}
                  isDark={isDark}
                  accent={nowAccent}
                  editorial="AI infrastructure, ETF flows and a narrow mega-cap leadership group carry the index near record levels. The surface is calm; the concentration is the story."
                />
                <PatternMarketCard
                  side="Then"
                  date={PAST}
                  label="The calm before 1907"
                  timeline={state.past}
                  summary={pastSummary}
                  isDark={isDark}
                  accent={pastAccent}
                  editorial="Railroads, electrification and trust consolidation were the growth story. The Panic of 1907 was still about a year away; the surface was calm then, too."
                />
              </>
            )}
          </div>
          {state.status === "error" ? (
            <p className="mt-2 text-micro text-[#c0442f] dark:text-[#ff8b77]">
              Market comparison unavailable: {state.error}
            </p>
          ) : null}
        </section>

        <section className="mt-10">
          <SectionLabel number="02">Geopolitics &amp; science</SectionLabel>
          <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl">
              Different tools, familiar tensions.
            </h2>
            <p className="max-w-xl text-micro leading-relaxed text-black/45 dark:text-white/45">
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
              accent={nowAccent}
              isDark={isDark}
            />
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
              accent={pastAccent}
              isDark={isDark}
            />
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
                    120
                  </span>
                  <span className="pb-2 text-micro uppercase tracking-[0.14em] text-black/35 dark:text-white/35">
                    years
                  </span>
                </div>
                <p className="mt-3 max-w-xs text-meta leading-relaxed text-black/55 dark:text-white/55">
                  The century repeats in structure: a new technology, a credit
                  cycle, and a contest for power.
                </p>
                <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-[#0f766e]/20 bg-[#0f766e]/10 px-3 py-1.5 text-micro font-medium text-[#0f766e] dark:border-[#5eead4]/20 dark:bg-[#5eead4]/10 dark:text-[#5eead4]">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  Strong echo
                </span>
              </div>

              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl">
                  History does not repeat. It rhymes.
                </h2>
                <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/55 dark:text-white/55">
                  Human emotion, debt and technological booms are the
                  constants. The 1906 boom in rails and electricity and the
                  2026 boom in AI and compute are different expressions of the
                  same sequence: a general-purpose technology attracts capital,
                  leverage amplifies the build-out, and the bill arrives when
                  the story stops compounding.
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
                      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-black/35 dark:text-white/35">
                        {label}
                      </p>
                      <p className="mt-1 text-micro leading-relaxed text-black/55 dark:text-white/55">
                        {text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-6 border-t border-black/5 pt-4 text-micro leading-relaxed text-black/40 dark:border-white/5 dark:text-white/40">
              The Repeatability Index is an editorial analogy, not a
              statistical forecast. Past structural echoes do not guarantee the
              timing or direction of the next turn.
            </p>
          </div>
        </section>

        <div className="mt-6 flex flex-col gap-3 border-t border-black/5 pt-4 text-micro text-black/40 dark:border-white/5 dark:text-white/40 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Study of Patterns · 2026 mirror · data from the StrikeHike macro
            archive
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/regime"
              className="text-black/55 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#c0442f] dark:text-white/55 dark:decoration-white/20 dark:hover:text-[#ff8b77]"
            >
              Open the Core Index atlas
            </Link>
            <Link
              href="/convergence"
              className="text-black/55 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#c0442f] dark:text-white/55 dark:decoration-white/20 dark:hover:text-[#ff8b77]"
            >
              Compare two events
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
