"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { CrashDetailPanel } from "@/components/regime/CrashDetailPanel";
import { PhasePlane } from "@/components/regime/PhasePlane";
import { OnboardingModal } from "@/components/ui/OnboardingModal";
import { RegimeTimeline } from "@/components/regime/RegimeTimeline";
import {
  coreIndexTone,
  formatDate,
  formatNumber,
  formatSigned,
} from "@/components/regime/regimeUtils";
import { useChronoStore } from "@/store/chronoStore";

function StatusBadge({ status }) {
  const config =
    status === "ready"
      ? {
          label: "Archive online",
          dot: "bg-[#0f766e] dark:bg-[#5eead4]",
          pulse: false,
        }
      : status === "error"
        ? {
            label: "Archive offline",
            dot: "bg-[#ef4444]",
            pulse: false,
          }
        : {
            label: "Reading archive",
            dot: "bg-[#d8b47a]",
            pulse: true,
          };

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/45 px-3 py-1.5 text-micro font-medium uppercase tracking-[0.12em] text-black/55 backdrop-blur-2xl dark:border-white/5 dark:bg-black/30 dark:text-white/55">
      <span
        className={`h-1.5 w-1.5 rounded-full ${config.dot} ${
          config.pulse ? "animate-pulse" : ""
        }`}
        aria-hidden="true"
      />
      {config.label}
    </span>
  );
}

function Stat({ label, value, suffix, detail, accent }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/45 px-4 py-3 backdrop-blur-2xl dark:border-white/5 dark:bg-black/30">
      <p className="text-micro uppercase tracking-[0.14em] text-black/40 dark:text-white/40">
        {label}
      </p>
      <p
        className="mt-1 font-mono text-xl font-medium tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4]"
        style={accent ? { color: accent } : undefined}
      >
        {value}
        {suffix ? (
          <span className="ml-1 text-micro font-normal tracking-normal text-black/35 dark:text-white/35">
            {suffix}
          </span>
        ) : null}
      </p>
      <p className="mt-0.5 text-micro text-black/45 dark:text-white/45">
        {detail}
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="mt-6 overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/45 p-5 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-2xl dark:border-white/5 dark:bg-black/40 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-micro uppercase tracking-[0.16em] text-black/45 dark:text-white/45">
          Loading 170 years of macro history
        </p>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d8b47a]" />
      </div>
      <div className="mt-5 h-[320px] animate-pulse rounded-2xl bg-black/[0.04] dark:bg-white/[0.05]" />
      <div className="mt-3 h-3 w-2/3 animate-pulse rounded-full bg-black/[0.04] dark:bg-white/[0.05]" />
    </section>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <section className="mt-6 overflow-hidden rounded-[1.6rem] border border-[#ef4444]/20 bg-white/45 p-5 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-2xl dark:border-[#ef4444]/25 dark:bg-black/40 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)] sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-micro uppercase tracking-[0.16em] text-[#c0442f] dark:text-[#ff8b77]">
            Archive offline
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
            The macro archive is not responding.
          </h2>
          <p className="mt-2 text-meta leading-relaxed text-black/55 dark:text-white/55">
            {message || "The API returned an empty response."}
          </p>
          <p className="mt-2 text-micro leading-relaxed text-black/40 dark:text-white/40">
            A 503 means the parquet artifact has not been published to this
            environment yet. The rest of the Chrono engine is unaffected.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-black/5 px-3.5 py-2 text-micro font-medium text-black/60 transition-colors hover:bg-black/[0.04] dark:border-white/5 dark:text-white/60 dark:hover:bg-white/[0.06]"
          >
            Retry
          </button>
          <Link
            href="/"
            className="rounded-full border border-transparent bg-[#14121a] px-3.5 py-2 text-micro font-medium text-[#f2ede4] transition-colors hover:bg-[#f05d49] dark:bg-[#f2ede4] dark:text-[#14121a] dark:hover:bg-[#ff8b77]"
          >
            Orrery
          </Link>
        </div>
      </div>
    </section>
  );
}

function MethodDetails({ meta }) {
  const notes = Array.isArray(meta?.notes) ? meta.notes : [];
  const sources = [
    ...(Array.isArray(meta?.proxy_sources) ? meta.proxy_sources : []),
    ...(meta?.assets?.nifty
      ? [
          {
            source: meta.assets.nifty.source ?? "YAHOO_FINANCE_NSEI",
            start: meta.assets.nifty.first_observation,
            end: meta.assets.nifty.last_observation,
          },
        ]
      : []),
  ];
  const allNotes = [
    "Core Index is a 40/30/30 descriptive composite: Macro 40% (credit 40%, Fed 30%, curve 30%), Volatility 30% (14d ATR / 20d Bollinger width) and Momentum 30% (MACD 12/26/9 / 14d RSI). The 0-100 composite is mapped to -50..+50. We read it as a contrarian sentiment map: +25 begins the Risk Elevated / trim band; -25 begins the Maximum Fear / accumulation band.",
    ...notes,
  ];

  return (
    <details className="group mt-4 rounded-[1.4rem] border border-black/5 bg-white/45 p-5 backdrop-blur-2xl dark:border-white/5 dark:bg-black/25 sm:p-6">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-micro font-medium uppercase tracking-[0.16em] text-black/50 [&::-webkit-details-marker]:hidden dark:text-white/50">
        Method & limits
        <span className="text-base font-normal text-black/30 transition-transform group-open:rotate-45 dark:text-white/30">
          +
        </span>
      </summary>

      <div className="mt-4 grid gap-5 sm:grid-cols-[1.15fr_0.85fr]">
        <ul className="space-y-2.5">
          {allNotes.map((note, index) => (
            <li
              key={`${index}-${note}`}
              className="flex gap-2 text-meta leading-relaxed text-black/55 dark:text-white/55"
            >
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#f05d49]" />
              <span>{note}</span>
            </li>
          ))}
        </ul>

        <div>
          <p className="text-micro uppercase tracking-[0.14em] text-black/40 dark:text-white/40">
            Asset proxy sources
          </p>
          <ul className="mt-2 space-y-1.5">
            {sources.map((source) => (
              <li
                key={`${source.source}-${source.start}`}
                className="font-mono text-micro text-black/50 dark:text-white/50"
              >
                {source.source} · {formatDate(source.start)} →{" "}
                {formatDate(source.end)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-4 border-t border-black/5 pt-3 text-micro leading-relaxed text-black/40 dark:border-white/5 dark:text-white/40">
        Data version {meta?.data_version ?? "—"} ·{" "}
        {meta?.core_index_version ?? meta?.strength_version ?? "—"} · Source
        FRED, World Bank, Blockchain.com, Yahoo Finance. Descriptive historical
        research. Not investment advice.
      </p>
    </details>
  );
}

export default function RegimePage() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState("sp500");
  const [compareAssets, setCompareAssets] = useState(false);
  const [hoverPoint, setHoverPoint] = useState(null);
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/v1/regime/macro-history?resolution=weekly", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.detail ||
              payload?.error ||
              `Macro archive returned ${response.status}.`,
          );
        }
        return response.json();
      })
      .then((payload) => {
        if (
          !Array.isArray(payload?.timeline) ||
          !Array.isArray(payload?.crashes)
        ) {
          throw new Error("The macro archive returned an unexpected payload.");
        }
        setState({ status: "ready", data: payload, error: null });
      })
      .catch((loadError) => {
        if (loadError.name !== "AbortError") {
          setState({
            status: "error",
            data: null,
            error: loadError.message,
          });
        }
      });

    return () => controller.abort();
  }, [reloadKey]);


  useEffect(() => {
    const date = new URLSearchParams(window.location.search).get("d");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const store = useChronoStore.getState();
    if (store.focusedDate !== date) store.setFocusedDate(date);
  }, []);

  const data = state.data;
  const latestCoreIndex = data?.meta?.latest_core_index ?? null;
  const latestTone = coreIndexTone(latestCoreIndex?.bucket, isDark);
  const selectedCrash = useMemo(
    () => data?.crashes.find((crash) => crash.id === selectedId) ?? null,
    [data, selectedId],
  );
  const phaseDate =
    (selectedCrash?.within_coverage ? selectedCrash.start : null) ??
    latestCoreIndex?.date ??
    data?.coverage?.end ??
    null;
  const phasePoint = useMemo(() => {
    if (!data?.timeline || !phaseDate) return null;
    return (
      data.timeline.find((point) => point.date >= phaseDate) ??
      data.timeline.at(-1) ??
      null
    );
  }, [data, phaseDate]);
  const phaseAsOf = hoverPoint?.date ?? phaseDate;
  const phaseDisplayPoint = hoverPoint ?? phasePoint;
  const phaseContext = hoverPoint
    ? "Hovered date"
    : selectedCrash?.within_coverage
      ? `${selectedCrash.name} peak`
      : "Latest observation";
  const orreryDate = selectedCrash?.start ?? latestCoreIndex?.date ?? null;

  const handleSelect = useCallback((crash) => {
    setSelectedId(crash.id);
    useChronoStore.getState().setFocusedDate(crash.start);
    const url = new URL(window.location.href);
    url.searchParams.set("d", crash.start);
    window.history.replaceState(null, "", url);
  }, []);

  const handleHoverPoint = useCallback((point) => {
    setHoverPoint(point ?? null);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("d");
    window.history.replaceState(null, "", url);
  }, []);

  const handleRetry = useCallback(() => {
    setState({ status: "loading", data: null, error: null });
    setReloadKey((key) => key + 1);
  }, []);

  return (
    <main className="relative h-full w-full overflow-y-auto overflow-x-hidden pb-24 pt-3 sm:pt-4">
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8">
        <header className="flex flex-col gap-4 pr-14 sm:pr-16 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-micro uppercase tracking-[0.2em] text-[#c0442f] dark:text-[#ff8b77]">
              Regime Intelligence
            </p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl lg:text-6xl">
              The −50 to +50 macro atlas.
            </h1>
            <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/55 dark:text-white/55 sm:text-body">
              One full-bleed market chart. The Core Index composite blends credit,
              volatility and momentum; every NBER window carries its own
              drawdown and score. Compare the S&amp;P 500, gold, Treasuries and
              Nifty 50 on a single percentage scale. The score is read
              contrarian: trim into euphoria, accumulate into fear. Research,
              not investment advice.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={state.status} />
            <span className="inline-flex items-center rounded-full border border-black/5 bg-white/35 px-3 py-1.5 text-micro text-black/45 backdrop-blur-2xl dark:border-white/5 dark:bg-black/25 dark:text-white/45">
              FRED ·{" "}
              {data?.coverage?.start?.slice(0, 4) ?? "1854"}–
              {data?.coverage?.end?.slice(0, 4) ?? "2026"}
            </span>
          </div>
        </header>

        {state.status === "loading" ? <LoadingState /> : null}

        {state.status === "error" ? (
          <ErrorState message={state.error} onRetry={handleRetry} />
        ) : null}

        {state.status === "ready" && data ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat
                label="Latest Core Index"
                value={formatSigned(latestCoreIndex?.score)}
                suffix="/ +50"
                detail={latestTone.label}
                accent={latestTone.color}
              />
              <Stat
                label="As of"
                value={latestCoreIndex?.date ? formatDate(latestCoreIndex.date) : "—"}
                detail={`${formatNumber(data.point_count)} timeline points`}
              />
              <Stat
                label="Coverage"
                value={`${data.coverage.years.toFixed(0)} yrs`}
                detail={`${data.coverage.start} → ${data.coverage.end}`}
              />
              <Stat
                label="NBER windows"
                value={String(data.crashes.length)}
                detail="Hover a red band · click to zoom"
              />
            </div>

            <RegimeTimeline
              timeline={data.timeline}
              crashes={data.crashes}
              selectedId={selectedId}
              onSelect={handleSelect}
              isDark={isDark}
              coverage={data.coverage}
              resolution={data.resolution}
              assetKey={selectedAsset}
              onAssetChange={setSelectedAsset}
              compareAssets={compareAssets}
              onCompareToggle={() => setCompareAssets((value) => !value)}
              onHoverPoint={handleHoverPoint}
            />

            <AnimatePresence mode="wait" initial={false}>
              {selectedCrash ? (
                <CrashDetailPanel
                  key={selectedCrash.id}
                  crash={selectedCrash}
                  isDark={isDark}
                  onClose={handleClose}
                />
              ) : null}
            </AnimatePresence>

            <div className="mt-4">
              <PhasePlane
                point={phaseDisplayPoint}
                asOf={phaseAsOf}
                contextLabel={phaseContext}
                isDark={isDark}
                assetKey={selectedAsset}
              />
            </div>

            <MethodDetails meta={data.meta} />

            <footer className="mt-6 flex flex-col gap-2 border-t border-black/5 pt-4 text-micro text-black/40 dark:border-white/5 dark:text-white/40 sm:flex-row sm:items-center sm:justify-between">
              <span>
                FRED · World Bank · Blockchain.com · Yahoo Finance ·{" "}
                {data.meta?.core_index_version ?? "core-index-v1"}
              </span>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new Event("strikehike:show-onboarding"),
                    )
                  }
                  className="text-black/55 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#c0442f] dark:text-white/55 dark:decoration-white/20 dark:hover:text-[#ff8b77]"
                >
                  How it works
                </button>
                <Link
                  href={
                    orreryDate
                      ? `/?d=${encodeURIComponent(orreryDate)}`
                      : "/"
                  }
                  className="text-black/55 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#c0442f] dark:text-white/55 dark:decoration-white/20 dark:hover:text-[#ff8b77]"
                >
                  Open the Orrery at this date
                </Link>
              </div>
            </footer>
          </>
        ) : null}
      </div>
      <OnboardingModal />
    </main>
  );
}
