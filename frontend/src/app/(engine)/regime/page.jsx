"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { AnimatePresence } from "framer-motion";
import { useTheme } from "next-themes";
import { CrashDetailPanel } from "@/components/regime/CrashDetailPanel";
import { PhasePlane } from "@/components/regime/PhasePlane";
import { OnboardingModal } from "@/components/ui/OnboardingModal";
import { RegimeTimeline } from "@/components/regime/RegimeTimeline";
import { MARKET_FLAGS, sourcePeriods } from "@/components/regime/regimeChart";
import {
  coreIndexTone,
  formatDate,
  formatNumber,
  formatSigned,
} from "@/components/regime/regimeUtils";
import { useChronoStore } from "@/store/chronoStore";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

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
    <span className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/45 px-3 py-1.5 text-micro font-medium uppercase tracking-[0.12em] text-black/60 dark:border-white/5 dark:bg-black/30 dark:text-white/60">
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
    <div className="py-3 sm:px-5 sm:first:pl-0">
      <p className="text-micro uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-medium tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4]">
        {value}
        {suffix ? (
          <span className="ml-1 text-micro font-normal tracking-normal text-black/60 dark:text-white/60">
            {suffix}
          </span>
        ) : null}
      </p>
      <p className="mt-0.5 text-micro text-black/60 dark:text-white/60">
        {accent ? (
          <span
            aria-hidden="true"
            className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
            style={{ backgroundColor: accent }}
          />
        ) : null}
        {detail}
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="mt-6 overflow-hidden rounded-[1.6rem] border border-(--sh-line-1) bg-white/45 p-5 dark:bg-black/40 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-micro uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
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
    <section className="mt-6 overflow-hidden rounded-[1.6rem] border border-[#ef4444]/20 bg-white/45 p-5 dark:border-[#ef4444]/25 dark:bg-black/40 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-micro uppercase tracking-[0.16em] text-[#c0442f] dark:text-[#ff8b77]">
            Archive offline
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
            The macro archive is not responding.
          </h2>
          <p className="mt-2 text-meta leading-relaxed text-black/60 dark:text-white/60">
            {message || "The API returned an empty response."}
          </p>
          <p className="mt-2 text-micro leading-relaxed text-black/60 dark:text-white/60">
            A 503 means the parquet artifact has not been published to this
            environment yet. The rest of the Chrono engine is unaffected.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-black/5 px-3.5 py-2 text-micro font-medium text-black/60 transition-colors hover:bg-black/[0.04] focus-visible:bg-black/[0.04] dark:border-white/5 dark:text-white/60 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
          >
            Retry
          </button>
          <Link
            href="/"
            className="rounded-full border border-transparent bg-[#14121a] px-3.5 py-2 text-micro font-medium text-[#f2ede4] transition-colors hover:bg-[#f05d49] hover:text-[#14121a] focus-visible:bg-[#f05d49] focus-visible:text-[#14121a] dark:bg-[#f2ede4] dark:text-[#14121a] dark:hover:bg-[#ff8b77] dark:focus-visible:bg-[#ff8b77]"
          >
            Orrery
          </Link>
        </div>
      </div>
    </section>
  );
}

// The footer's quiet links; 44 px tall on touch, like the other engine
// pages' footers.
const FOOTER_LINK =
  "text-black/60 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center dark:text-white/60 dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]";

// Core Index v2 as the backend contract words it (§5.1), shown only when the
// payload lacks the backend's own fuller v2 note, and the contrarian reading,
// kept verbatim.
const CORE_INDEX_NOTE =
  "Core Index v2 is a weekly trend-and-stress state machine: the equity proxy against its 40-week average and its own volatility, with credit spreads, unemployment and the yield curve as stress inputs, each lagged by its publication delay; it is decided at the Friday close and starts at the end of 1928.";
const CONTRARIAN_NOTE =
  "We read it as a contrarian sentiment map: +25 begins the Risk Elevated / trim band; -25 begins the Maximum Fear / accumulation band.";
// The drawn S&P line crosses the 1927 splice of two separate indices.
const SPLICE_NOTE =
  "The chart joins the Cowles index to the S&P 90 at 30 Dec 1927 for display only; the two indices' levels do not compare across that date.";

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

// "Dec 1928" from an ISO day, or null.
function monthOf(value) {
  const text = formatDate(value);
  return text === "—" ? null : text.slice(3);
}

function shareOf(value) {
  const percent = value * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

function flagLabel(field) {
  const flag = MARKET_FLAGS.find((item) => item.field === field);
  return `${flag.label}: ${flag.text}.`;
}

// A flag's measured record (meta …record) in one passage: its hits, its
// misses and its false warnings together, every figure read from the payload.
// Null when any of the three is missing, so none is ever shown alone. The
// definition of a false warning is given once (`define`), from the trend
// record: no text from the fast warning's meta is shown (contract §7.2).
function recordPassage(record, { define = false } = {}) {
  const falls = record?.falls_of_20pct_or_more;
  const count = falls?.count;
  const hits = falls?.on_within_first_20pct ?? falls?.within_first_20pct;
  const misses = falls?.not_within_first_20pct;
  const rates = record?.false_alarms_per_decade;
  if (![count, hits, misses, rates?.all].every(isNumber)) return null;
  const kinds = [];
  if (isNumber(falls.during_the_fall) && isNumber(falls.before_the_peak_only)) {
    kinds.push(
      `${falls.during_the_fall} during the fall`,
      `${falls.before_the_peak_only} only before the peak`,
    );
  }
  if (falls.left_on_from_the_decline_before > 0) {
    kinds.push(
      `${falls.left_on_from_the_decline_before} of them only because it was still on from the decline before`,
    );
  }
  const eras = Object.entries(rates)
    .filter(([key, value]) => key !== "all" && isNumber(value))
    .map(([key, value]) => `${value.toFixed(1)} in ${key.replace("-", "–")}`);
  const from = monthOf(record.measured_on?.first_week ?? record.measured_on?.first_day);
  const to = monthOf(record.measured_on?.last_week ?? record.measured_on?.last_day);
  const weeksOn = record.share_of_weeks_on?.all;
  const daysOn = record.share_of_days_on?.all;
  const definition = define ? record.definitions?.false_alarm : null;
  return [
    from && to ? `Its record, ${from} to ${to}: it` : "Its record: it",
    ` came on before the market had done a fifth of the fall in ${hits} of the ${count} falls of 20% or more`,
    kinds.length ? ` (${kinds.join(", ")})` : "",
    ` and later than that in ${misses} of ${count}; it gave ${rates.all.toFixed(1)} false warnings a decade`,
    eras.length ? ` (${eras.join(", ")})` : "",
    isNumber(weeksOn)
      ? ` and was on in ${shareOf(weeksOn)} of weeks.`
      : isNumber(daysOn)
        ? ` and was on ${shareOf(daysOn)} of days.`
        : ".",
    definition ? ` A false warning is ${definition}.` : "",
    " A historical record, not a forecast.",
  ].join("");
}

// The weekly trend warning: its label, its rule from the meta, and its record.
function trendNote(trend) {
  if (!trend) return null;
  const rule = isNumber(trend.weeks)
    ? ` It is on when the S&P 500's (the S&P 90's before March 1957) Friday close is below the average of its last ${trend.weeks} Friday closes: a textbook rule${
        trend.fitted === false ? ", not fitted to this history" : ""
      }, chosen after seeing its record${
        trend.changes_core_index === false
          ? ", and shown beside the Core Index without changing it"
          : ""
      }.`
    : "";
  const record = recordPassage(trend.record, { define: true });
  return `${flagLabel("core_index_trend_warning")}${rule}${record ? ` ${record}` : ""}`;
}

// The daily fast warning, when the backend sends one: the same three parts.
function fastNote(fast) {
  if (!fast) return null;
  const rule =
    isNumber(fast.drop) && isNumber(fast.days)
      ? ` It is on when the S&P 500 (the S&P 90 before March 1957) closes ${Math.round(fast.drop * 100)}% or more below its close ${fast.days} calendar days earlier, decided at each close (a week shows it if it was on any day): a reaction to a sharp fall, chosen after seeing this history${
          fast.changes_core_index === false
            ? ", and shown beside the Core Index without changing it"
            : ""
        }.`
      : "";
  const record = recordPassage(fast.record);
  return `${flagLabel("core_index_fast_warning")}${rule}${record ? ` ${record}` : ""}`;
}

function MethodDetails({ meta }) {
  const notes = Array.isArray(meta?.notes) ? meta.notes : [];
  const sources = sourcePeriods([
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
  ]);
  const firstScored = monthOf(meta?.core_index_first_scored);
  const severities = (
    Array.isArray(meta?.core_index_severities) ? meta.core_index_severities : []
  ).filter((name) => name !== "none");
  // The backend's own Core Index v2 note leads, as the fuller description;
  // the contract's sentence stands in only when the payload lacks it, so the
  // description is never given twice.
  const v2Index = notes.findIndex(
    (note) => typeof note === "string" && note.startsWith("Core Index v2"),
  );
  const allNotes = [
    v2Index >= 0 ? notes[v2Index] : CORE_INDEX_NOTE,
    CONTRARIAN_NOTE,
    `${firstScored ? `Every weekly reading from ${firstScored} is shown. ` : ""}The rules were designed and tuned on the years from 1971 on, so 1929–71 served as the out-of-sample test, and few stress inputs existed before 1953.`,
    `Severity, shown as the decline class${
      severities.length > 1
        ? ` (${severities.slice(0, -1).join(", ")} or ${severities.at(-1)})`
        : ""
    }, is the class a decline has reached in the current spell. It only steps up within a spell, so it can still read crash in a recovery; in Maximum Fear it is the class of the decline being bought. A warning can show while Balanced Growth or Trim; it does not change the allocation.`,
    trendNote(meta?.core_index_trend_warning),
    fastNote(meta?.core_index_fast_warning),
    ...notes.filter((_, index) => index !== v2Index),
  ].filter(Boolean);

  return (
    <details className="group mt-4 rounded-[1.4rem] border border-(--sh-line-1) bg-white/45 p-5 dark:bg-black/25 sm:p-6">
      <summary className="-m-2 flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-2 text-micro font-medium uppercase tracking-[0.16em] text-black/60 [&::-webkit-details-marker]:hidden dark:text-white/60">
        Method & limits
        <span className="text-base font-normal text-black/60 transition-transform group-open:rotate-45 dark:text-white/60" aria-hidden="true">
          +
        </span>
      </summary>

      <div className="mt-4 grid gap-5 sm:grid-cols-[1.15fr_0.85fr]">
        <ul className="space-y-2.5">
          {allNotes.map((note, index) => (
            <li
              key={`${index}-${note}`}
              className="flex gap-2 text-meta leading-relaxed text-black/60 dark:text-white/60"
            >
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#f05d49]" />
              <span>{note}</span>
            </li>
          ))}
        </ul>

        <div>
          <p className="text-micro uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
            Asset proxy sources
          </p>
          <ul className="mt-2 space-y-1.5">
            {sources.map((source) => (
              <li
                key={`${source.source}-${source.start}`}
                title={source.source}
                className="text-micro text-black/60 dark:text-white/60"
              >
                {source.label} ·{" "}
                <span className="font-mono">
                  {formatDate(source.start)} → {formatDate(source.end)}
                </span>
              </li>
            ))}
          </ul>
          {sources.some((source) => source.source === "M1125AUSM343NNBR") ? (
            <p className="mt-2 text-micro leading-relaxed text-black/60 dark:text-white/60">
              {SPLICE_NOTE}
            </p>
          ) : null}
        </div>
      </div>

      <p className="mt-4 border-t border-black/5 pt-3 text-micro leading-relaxed text-black/60 dark:border-white/5 dark:text-white/60">
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
  // false during SSR/hydration, true after: server and first client render agree.
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const isDark = mounted ? resolvedTheme !== "light" : true;
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

    // view=atlas: only the fields this page reads (≈1.7 MB instead of 11 MB);
    // the route sends Cache-Control, so repeat visits reuse it.
    fetch("/api/v1/regime/macro-history?resolution=weekly&view=atlas", {
      signal: controller.signal,
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
  // Today's flags, named in the summary only while they are on, in one
  // compact phrase: "trend warning", or "Core Index, trend and fast warnings".
  const latestFlags = [
    [
      latestCoreIndex?.warning === true &&
        (latestCoreIndex?.bucket === "calm_bullish" ||
          latestCoreIndex?.bucket === "strong_bullish"),
      "Core Index",
      "warning",
    ],
    [latestCoreIndex?.trend_warning === true, "trend", "trend warning"],
    [latestCoreIndex?.fast_warning === true, "fast", "fast warning"],
  ].filter(([on]) => on);
  const latestFlagNames = latestFlags.map(([, name]) => name);
  const latestFlagText =
    latestFlags.length === 1
      ? latestFlags[0][2]
      : latestFlags.length
        ? `${latestFlagNames.slice(0, -1).join(", ")} and ${latestFlagNames.at(-1)} warnings`
        : "";
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
    <main className="relative h-full w-full scroll-pt-(--sh-header-clear) overflow-y-auto overflow-x-hidden pb-24 sm-tall:scroll-pt-[calc(var(--sh-header-clear)_+_var(--regime-hud-h,0px))]">
      {/* Where the HUD sticks (sm-tall), in-page scrolling and keyboard focus
          also clear its measured height (--regime-hud-h, set by
          RegimeTimeline). */}
      {/* The top padding (the header clearance) lives here, not on the scroll
          container, so the HUD sticks at the same offset with no slit above
          it. */}
      <div className="mx-auto w-full max-w-[1600px] px-3 pt-(--sh-header-clear) sm:px-5 lg:px-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-micro uppercase tracking-[0.2em] text-[#a83a27] dark:text-[#ff8b77]">
              Regime Intelligence
            </p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl">
              The −50 to +50 macro atlas.
            </h1>
            <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/60 dark:text-white/60 sm:text-body">
              One full-bleed market chart. The Core Index reads the
              S&amp;P 500&apos;s trend and volatility against credit,
              unemployment and yield-curve stress each Friday; every NBER window
              carries its own drawdown and score. Compare the S&amp;P 500, gold,
              Treasuries and Nifty 50 on a single percentage scale. The score is read
              contrarian: trim into euphoria, accumulate into fear. Research,
              not investment advice.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={state.status} />
            <span className="inline-flex items-center rounded-full border border-black/5 bg-white/35 px-3 py-1.5 text-micro text-black/60 dark:border-white/5 dark:bg-black/25 dark:text-white/60">
              FRED ·{" "}
              {data?.coverage?.start?.slice(0, 4) ?? "1854"}–
              {data?.coverage?.end?.slice(0, 4) ?? "2026"}
            </span>
          </div>
        </header>

        {state.status === "loading" ? <LoadingState /> : null}

        {state.status === "error" ? (
          <>
            <ErrorState message={state.error} onRetry={handleRetry} />
            {/* The footer's links stay when the archive is offline. */}
            <div className="mt-4 flex flex-wrap justify-end gap-3 text-micro">
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new Event("strikehike:show-onboarding"))
                }
                className={FOOTER_LINK}
              >
                How it works
              </button>
              <Link href="/disclaimer" className={FOOTER_LINK}>
                Disclaimer
              </Link>
            </div>
          </>
        ) : null}

        {state.status === "ready" && data ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-x-4 border-y border-(--sh-line-1) sm:grid-cols-4 sm:gap-x-0 sm:divide-x sm:divide-(--sh-line-1)">
              <Stat
                label="Latest Core Index"
                value={formatSigned(latestCoreIndex?.score)}
                suffix="/ +50"
                detail={
                  latestFlagText ? (
                    // Two unbreakable parts: a narrow column wraps between
                    // them, never inside one.
                    <>
                      <span className="whitespace-nowrap">
                        {latestTone.label} ·
                      </span>{" "}
                      <span className="whitespace-nowrap">{latestFlagText}</span>
                    </>
                  ) : (
                    latestTone.label
                  )
                }
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
                detail={`${formatDate(data.coverage.start)} → ${formatDate(data.coverage.end)}`}
              />
              <Stat
                label="NBER windows"
                value={String(data.crashes.length)}
                detail={
                  <>
                    <span className="[@media(hover:none)]:hidden">
                      Hover a red band · click to zoom
                    </span>
                    <span className="hidden [@media(hover:none)]:inline">
                      Press and hold the chart to scrub
                    </span>
                  </>
                }
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

            <footer className="mt-6 flex flex-col gap-2 border-t border-black/5 pt-4 text-micro text-black/60 dark:border-white/5 dark:text-white/60 sm:flex-row sm:items-center sm:justify-between">
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
                  className={FOOTER_LINK}
                >
                  How it works
                </button>
                <Link
                  href={
                    orreryDate
                      ? `/?d=${encodeURIComponent(orreryDate)}`
                      : "/"
                  }
                  className={FOOTER_LINK}
                >
                  Open the Orrery at this date
                </Link>
                <Link
                  href="/disclaimer"
                  className={FOOTER_LINK}
                >
                  Disclaimer
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
