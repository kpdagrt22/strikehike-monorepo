"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTheme } from "next-themes";
import { Deferred } from "@/components/Deferred";
import { dateTravelled, methodOpened } from "@/lib/analytics/events";
import { buildCrashMetrics } from "@/components/regime/regimeMetrics";
import { urlFor } from "@/lib/seo/site";
import { useChronoStore } from "@/store/chronoStore";

const CrashDetailPanel = dynamic(
  () =>
    import("@/components/regime/CrashDetailPanel").then(
      (module) => module.CrashDetailPanel,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="mt-4 h-[420px] animate-pulse rounded-[1.6rem] border border-(--sh-line-1) bg-(--sh-hover) motion-reduce:animate-none" />
    ),
  },
);

const RegimeTimeline = dynamic(
  () =>
    import("@/components/regime/RegimeTimeline").then(
      (module) => module.RegimeTimeline,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="mt-4 h-[calc(68vh+9.5rem)] min-h-[672px] animate-pulse rounded-2xl border border-(--sh-line-1) bg-(--sh-hover) motion-reduce:animate-none" />
    ),
  },
);

const RecessionWindows = dynamic(
  () =>
    import("@/components/regime/RecessionWindows").then(
      (module) => module.RecessionWindows,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="mt-4 h-[20rem] animate-pulse rounded-2xl border border-(--sh-line-1) bg-(--sh-hover) motion-reduce:animate-none" />
    ),
  },
);

const PhasePlane = dynamic(
  () =>
    import("@/components/regime/PhasePlane").then(
      (module) => module.PhasePlane,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="mt-4 h-[420px] animate-pulse rounded-2xl border border-(--sh-line-1) bg-(--sh-hover) motion-reduce:animate-none" />
    ),
  },
);

const OnboardingModal = dynamic(
  () =>
    import("@/components/ui/OnboardingModal").then(
      (module) => module.OnboardingModal,
    ),
  { ssr: false },
);

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function ErrorState({ onRetry }) {
  return (
    <section data-regime-error="" className="mt-6 overflow-hidden rounded-[1.6rem] border border-[#ef4444]/20 bg-white/45 p-5 dark:border-[#ef4444]/25 dark:bg-black/40 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <p className="text-micro uppercase tracking-[0.16em] text-[#c0442f] dark:text-[#ff8b77]">
            Archive offline
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
            The macro archive is not responding.
          </h2>
          <p className="mt-2 text-meta leading-relaxed text-black/60 dark:text-white/60">
            The page could not read the weekly history. Try again in a moment.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-retry=""
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

/**
 * The /regime view. `page.tsx` renders it on the server with the summary it
 * read (`initialSummary`: the archive's meta, coverage and window count, or
 * null), the server-rendered NBER table (`after`, placed after Method &
 * limits) and the site colophon (`colophon`, the container's last child).
 *
 * @param {{
 *   initialSummary?: { as_of?: string, coverage?: object, meta?: object, windows?: number } | null,
 *   header?: import("react").ReactNode,
 *   boot?: import("react").ReactNode,
 *   method?: import("react").ReactNode,
 *   after?: import("react").ReactNode,
 *   colophon?: import("react").ReactNode,
 * }} props
 */
export default function RegimeClient({
  initialSummary = null,
  header = null,
  boot = null,
  method = null,
  after = null,
  colophon = null,
}) {
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
    full: false,
  });
  const fullStarted = useRef(false);

  const loadFull = useCallback(() => {
    if (fullStarted.current) return;
    fullStarted.current = true;
    fetch("/api/v1/regime/macro-history?resolution=weekly&view=atlas")
      .then(async (response) => {
        if (!response.ok) throw new Error("full atlas unavailable");
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload?.timeline)) return;
        setState((previous) =>
          previous.status === "ready"
            ? { ...previous, data: payload, full: true }
            : previous,
        );
      })
      .catch(() => {
        // The lite view stays usable; a later intent may try again.
        fullStarted.current = false;
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fullStarted.current = false;

    // view=lite: the visible range and only the first-paint fields. A phone
    // asks for the last 20 years; a desktop keeps the full range.
    const phone = window.matchMedia("(max-width: 639.98px)").matches;
    const start = phone ? `${new Date().getFullYear() - 20}-01-01` : null;
    const params = new URLSearchParams({
      resolution: "weekly",
      view: "lite",
      asset: "sp500",
    });
    if (start) params.set("start", start);

    fetch(`/api/v1/regime/macro-history?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Macro archive unavailable.");
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
        setState({ status: "ready", data: payload, error: null, full: false });
      })
      .catch((loadError) => {
        if (loadError.name !== "AbortError") {
          setState({
            status: "error",
            data: null,
            error: "The macro archive is not responding.",
            full: false,
          });
        }
      });

    return () => controller.abort();
  }, [reloadKey]);

  // Fetch the rest once the page is idle, or as soon as the reader scrubs,
  // changes asset or opens a window.
  useEffect(() => {
    if (state.status !== "ready" || state.full) return undefined;
    let idle = 0;
    let timer = 0;
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(loadFull, { timeout: 2_500 });
    } else {
      timer = window.setTimeout(loadFull, 1_500);
    }
    return () => {
      if (idle && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idle);
      }
      if (timer) window.clearTimeout(timer);
    };
  }, [state.status, state.full, loadFull]);


  useEffect(() => {
    const date = new URLSearchParams(window.location.search).get("d");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const store = useChronoStore.getState();
    if (store.focusedDate !== date) {
      dateTravelled("deep_link", date);
      store.setFocusedDate(date);
    }
  }, []);

  const data = state.data;
  // Until the archive arrives (or if it fails), the summary the server read
  // with the page fills Method & record with the same meta, so the page reads
  // the same before and after hydration, and without JS.
  const summary = data ? null : initialSummary;
  const meta = data?.meta ?? summary?.meta ?? null;
  const latestCoreIndex = meta?.latest_core_index ?? null;
  const crashMetrics = useMemo(
    () => (data?.timeline ? buildCrashMetrics(data.timeline, data.crashes) : []),
    [data],
  );
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
    loadFull();
    setSelectedId(crash.id);
    useChronoStore.getState().setFocusedDate(crash.start);
    const url = new URL(window.location.href);
    url.searchParams.set("d", crash.start);
    window.history.replaceState(null, "", url);
  }, [loadFull]);

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
        {header}

        {state.status === "loading" ? boot : null}

        {state.status === "error" ? (
          <>
            <ErrorState onRetry={handleRetry} />
            {/* The footer's links stay when the archive is offline. */}
            <div className="mt-4 flex flex-wrap justify-end gap-3 text-micro">
              <button
                type="button"
                onClick={() => {
                  methodOpened("how_it_works", "/regime");
                  window.dispatchEvent(new Event("strikehike:show-onboarding"));
                }}
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
            <RegimeTimeline
              timeline={data.timeline}
              crashes={data.crashes}
              selectedId={selectedId}
              onSelect={handleSelect}
              isDark={isDark}
              coverage={data.coverage}
              resolution={data.resolution}
              assetKey={selectedAsset}
              onAssetChange={(key) => {
                loadFull();
                setSelectedAsset(key);
              }}
              compareAssets={compareAssets}
              onCompareToggle={() => {
                loadFull();
                setCompareAssets((value) => !value);
              }}
              onHoverPoint={handleHoverPoint}
              onNeedFull={loadFull}
            />

            {selectedCrash ? (
              <CrashDetailPanel
                key={selectedCrash.id}
                crash={selectedCrash}
                isDark={isDark}
                onClose={handleClose}
                shareUrl={urlFor(`/regime?d=${selectedCrash.start}`)}
              />
            ) : null}

            <Deferred minHeight={360} label="Loading recession windows">
              <RecessionWindows
                metrics={crashMetrics}
                crashes={data.crashes}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            </Deferred>

            <Deferred minHeight={440} label="Loading the cycle map">
              <div className="mt-4">
                <PhasePlane
                  point={phaseDisplayPoint}
                  asOf={phaseAsOf}
                  contextLabel={phaseContext}
                  isDark={isDark}
                  assetKey={selectedAsset}
                />
              </div>
            </Deferred>
          </>
        ) : null}

        {/* Outside the status gates: from the server's summary until the
            archive arrives, then from the archive (the same meta). */}
        {method}

        {after}

        {state.status === "ready" && data ? (
          <footer className="mt-6 flex flex-col gap-2 border-t border-black/5 pt-4 text-micro text-black/60 dark:border-white/5 dark:text-white/60 sm:flex-row sm:items-center sm:justify-between">
            <span>
              FRED · World Bank · Blockchain.com · Yahoo Finance ·{" "}
              {data.meta?.core_index_version ?? "core-index-v1"}
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  methodOpened("how_it_works", "/regime");
                  window.dispatchEvent(
                    new Event("strikehike:show-onboarding"),
                  );
                }}
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
        ) : null}

        {colophon}
      </div>
      <OnboardingModal />
    </main>
  );
}
