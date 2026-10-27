"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTheme } from "next-themes";
import { AstroLens } from "@/components/regime/AstroLens";
import { ConvergenceMiniChart } from "@/components/regime/ConvergenceMiniChart";
import { OnboardingModal } from "@/components/ui/OnboardingModal";
import {
  CONVERGENCE_ASSET_ORDER,
  ASSET_TARGETS,
  getAssetTarget,
} from "@/components/regime/assetTargets";
import {
  coreIndexTone,
  formatDate,
  formatNumber,
  formatPercent,
  formatSigned,
} from "@/components/regime/regimeUtils";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function StatusBadge({ status }) {
  const config =
    status === "ready"
      ? {
          label: "Convergence online",
          dot: "bg-[#0f766e] dark:bg-[#5eead4]",
          pulse: false,
        }
      : status === "error"
        ? {
            label: "Convergence offline",
            dot: "bg-[#ef4444]",
            pulse: false,
          }
        : {
            label: "Reading event archive",
            dot: "bg-[#d8b47a]",
            pulse: true,
          };

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/45 px-3 py-1.5 text-micro font-medium uppercase tracking-[0.12em] text-black/60 backdrop-blur-2xl dark:border-white/5 dark:bg-black/30 dark:text-white/60">
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

function CoreIndexScale({ peak, trough, isDark }) {
  const peakTone = coreIndexTone(
    peak == null
      ? null
      : peak >= 25
        ? "strong_bullish"
        : peak >= 0
          ? "calm_bullish"
          : peak > -25
            ? "bearish_warning"
            : "extreme_bearish",
    isDark,
  );
  const troughTone = coreIndexTone(
    trough == null
      ? null
      : trough >= 25
        ? "strong_bullish"
        : trough >= 0
          ? "calm_bullish"
          : trough > -25
            ? "bearish_warning"
            : "extreme_bearish",
    isDark,
  );
  const position = (value) =>
    value == null ? 0 : Math.max(0, Math.min(100, ((value + 50) / 100) * 100));

  return (
    <div className="mt-3">
      <div className="relative h-2 rounded-full border border-black/5 bg-black/[0.04] dark:border-white/5 dark:bg-white/[0.06]">
        <span
          className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-black/20 dark:bg-white/20"
          style={{ left: "50%" }}
          aria-hidden="true"
        />
        {peak != null ? (
          <span
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white dark:border-[#08080c]"
            style={{
              left: `${position(peak)}%`,
              backgroundColor: peakTone.color,
              boxShadow: `0 0 12px ${peakTone.color}88`,
            }}
            title={`Peak Core Index ${formatSigned(peak)}`}
          />
        ) : null}
        {trough != null ? (
          <span
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white dark:border-[#08080c]"
            style={{
              left: `${position(trough)}%`,
              backgroundColor: troughTone.color,
              boxShadow: `0 0 10px ${troughTone.color}66`,
            }}
            title={`Trough Core Index ${formatSigned(trough)}`}
          />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between font-mono text-micro text-black/60 dark:text-white/60">
        <span>−50</span>
        <span>0</span>
        <span>+50</span>
      </div>
    </div>
  );
}

function EventPanel({
  side,
  event,
  events,
  onChange,
  timeline,
  windowStatus,
  windowError,
  onRetryWindow,
  assetKey,
  asset,
  isDark,
}) {
  const headingRef = useRef(null);
  const coreIndex = event?.core_index ?? {};
  const hasTrough = event?.trough != null;
  const headlineScore = hasTrough ? coreIndex.at_trough : coreIndex.at_peak;
  const headlineBucket = hasTrough
    ? coreIndex.at_trough_bucket
    : coreIndex.at_peak_bucket;
  const headlineTone = coreIndexTone(headlineBucket, isDark);
  const headlineLabel = hasTrough ? "Core Index at trough" : "Core Index at peak";
  const stats = event?.assets?.[assetKey] ?? null;
  const hasAsset = Boolean(stats?.available);

  const handleRetryWindow = () => {
    // The error box (and this button) unmount on retry; keep focus in the panel.
    headingRef.current?.focus({ preventScroll: true });
    onRetryWindow();
  };

  return (
    <article className="overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/45 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-2xl dark:border-white/5 dark:bg-black/40 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
      <div className="border-b border-black/5 p-5 dark:border-white/5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <p className="text-micro font-medium uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
            {side} · {event?.category ?? "event"}
          </p>
          <span className="shrink-0 whitespace-nowrap font-mono text-micro text-black/60 dark:text-white/60">
            {event?.window?.start} → {event?.window?.end}
          </span>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-[-0.04em] text-[#14121a] focus:outline-none dark:text-[#f2ede4] sm:text-3xl"
            >
              {event?.name ?? "Select an event"}
            </h2>
            <p className="mt-1 text-micro text-black/60 dark:text-white/60">
              {event?.tags?.join(" · ")}
            </p>
          </div>
          <label className="shrink-0">
            <span className="sr-only">Choose {side} event</span>
            <select
              value={event?.id ?? ""}
              onChange={(eventTarget) => onChange(eventTarget.target.value)}
              className="max-w-[15rem] rounded-full border border-black/5 bg-white/45 px-3 py-1.5 font-sans text-micro text-black/60 focus:border-[#c0442f]/40 dark:border-white/5 dark:bg-black/30 dark:text-white/60"
            >
              {(events ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="rounded-2xl border border-black/5 bg-black/[0.02] p-4 dark:border-white/5 dark:bg-white/[0.025]">
            <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
              {headlineLabel}
            </p>
            <div className="mt-2 flex items-end gap-2">
              <span
                className="font-mono text-[2.6rem] font-medium leading-[0.8] tracking-[-0.06em]"
                style={{ color: headlineTone.color }}
              >
                {formatSigned(headlineScore)}
              </span>
              <span className="pb-0.5 font-mono text-micro text-black/60 dark:text-white/60">
                / +50
              </span>
            </div>
            <p
              className="mt-2 text-micro font-medium"
              style={{ color: headlineTone.color }}
            >
              {headlineTone.label}
            </p>
            <CoreIndexScale
              peak={coreIndex.at_peak}
              trough={coreIndex.at_trough}
              isDark={isDark}
            />
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-black/5 pt-2.5 dark:border-white/5">
              <span className="text-micro uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
                Peak reading
              </span>
              <span className="font-mono text-micro text-black/60 dark:text-white/60">
                {formatSigned(coreIndex.at_peak)}
              </span>
            </div>
            <p className="mt-2 text-micro leading-relaxed text-black/60 dark:text-white/60">
              {formatDate(coreIndex.at_trough_date ?? coreIndex.at_peak_date)} event
              reading · {coreIndex.observations ?? 0} composite obs in window
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
                {asset.metricLabel} · event tape
              </p>
              <span
                className="rounded-full bg-white/80 px-2 py-0.5 font-mono text-micro text-(--asset-light) dark:bg-(--asset-dark)/8 dark:text-(--asset-dark)"
                style={{
                  "--asset-light": asset.light,
                  "--asset-dark": asset.dark,
                }}
              >
                {asset.label}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-black/5 bg-white/35 px-3 py-2 dark:border-white/5 dark:bg-black/20">
                <p className="text-micro uppercase tracking-[0.1em] text-black/60 dark:text-white/60">
                  Window return
                </p>
                <p
                  className="mt-0.5 font-mono text-body font-medium"
                  style={{
                    color:
                      !hasAsset || stats.return_pct == null
                        ? undefined
                        : stats.return_pct >= 0
                          ? isDark
                            ? "#5eead4"
                            : "#0f766e"
                          : isDark
                            ? "#fb7185"
                            : "#c0442f",
                  }}
                >
                  {hasAsset ? formatPercent(stats.return_pct, 1) : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-black/5 bg-white/35 px-3 py-2 dark:border-white/5 dark:bg-black/20">
                <p className="text-micro uppercase tracking-[0.1em] text-black/60 dark:text-white/60">
                  Peak-to-trough
                </p>
                <p className="mt-0.5 font-mono text-body font-medium text-[#c0442f] dark:text-[#ff8b77]">
                  {hasAsset ? formatPercent(stats.drawdown_pct, 1) : "—"}
                </p>
              </div>
            </div>
            <div className="mt-3">
              {windowStatus === "loading" ? (
                <div className="h-[150px] animate-pulse rounded-xl bg-black/[0.04] dark:bg-white/[0.05]" />
              ) : windowStatus === "error" ? (
                <div className="grid h-[150px] place-content-center justify-items-center gap-2 rounded-xl border border-[#ef4444]/20 px-4 text-center text-micro text-[#c0442f] dark:text-[#ff8b77]">
                  <p>{windowError || "Daily window unavailable."}</p>
                  <button
                    type="button"
                    onClick={handleRetryWindow}
                    className="rounded-full border border-black/14 px-3 py-1.5 text-micro font-medium text-black/70 transition-colors hover:bg-black/4 focus-visible:bg-black/4 pointer-coarse:min-h-11 dark:border-white/14 dark:text-white/70 dark:hover:bg-white/6 dark:focus-visible:bg-white/6"
                  >
                    Retry window
                  </button>
                </div>
              ) : (
                <ConvergenceMiniChart
                  timeline={timeline}
                  assetKey={assetKey}
                  event={event}
                  isDark={isDark}
                />
              )}
            </div>
            <p className="mt-2 text-micro text-black/60 dark:text-white/60">
              {hasAsset
                ? `${formatNumber(stats.start_value, asset.precision)} → ${formatNumber(stats.end_value, asset.precision)} ${asset.unit} · indexed to 100 at the window start (log scale).`
                : `No ${asset.label} observation in this window.`}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <AstroLens
            key={event?.id}
            asOf={event?.peak}
            contextLabel={event?.short_name ?? "peak"}
          />
        </div>

        <p className="mt-4 border-t border-black/5 pt-3 text-meta leading-relaxed text-black/70 dark:border-white/5 dark:text-white/70">
          {event?.summary}
        </p>
        <p className="mt-2 text-micro leading-relaxed text-black/60 dark:text-white/60">
          {event?.context}
        </p>
      </div>
    </article>
  );
}

function ComparisonRead({ left, right, assetKey, asset, isDark }) {
  const leftScore =
    left?.trough != null ? left?.core_index?.at_trough : left?.core_index?.at_peak;
  const rightScore =
    right?.trough != null
      ? right?.core_index?.at_trough
      : right?.core_index?.at_peak;
  const leftDrawdown = left?.assets?.[assetKey]?.drawdown_pct;
  const rightDrawdown = right?.assets?.[assetKey]?.drawdown_pct;
  const scoreGap =
    leftScore != null && rightScore != null
      ? Math.abs(leftScore - rightScore)
      : null;
  const drawdownGap =
    leftDrawdown != null && rightDrawdown != null
      ? Math.abs(leftDrawdown - rightDrawdown)
      : null;
  const leftTone = coreIndexTone(
    left?.trough != null
      ? left?.core_index?.at_trough_bucket
      : left?.core_index?.at_peak_bucket,
    isDark,
  );
  const rightTone = coreIndexTone(
    right?.trough != null
      ? right?.core_index?.at_trough_bucket
      : right?.core_index?.at_peak_bucket,
    isDark,
  );

  return (
    <section className="mt-4 overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/45 p-5 backdrop-blur-2xl dark:border-white/5 dark:bg-black/30 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-micro uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
            Convergence read
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4] sm:text-2xl">
            Same lens, different tape.
          </h2>
        </div>
        <p className="max-w-xl text-micro leading-relaxed text-black/60 dark:text-white/60">
          Core Index is a contrarian sentiment composite; the asset columns show
          how the same macro state travelled through {asset.label.toLowerCase()}.
          A high score means euphoria and elevated risk, a low score means fear
          and accumulation. It is not a directional prediction.
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-black/5 bg-white/50 px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
          <p className="text-micro uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
            Trough Core Index gap
          </p>
          <p className="mt-1 font-mono text-lg text-[#14121a] dark:text-[#f2ede4]">
            {scoreGap == null ? "—" : `${scoreGap.toFixed(1)} pts`}
          </p>
        </div>
        <div className="rounded-xl border border-black/5 bg-white/50 px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
          <p className="text-micro uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
            Trough readings
          </p>
          <p className="mt-1 flex items-center gap-2 font-mono text-lg">
            <span style={{ color: leftTone.color }}>
              {formatSigned(leftScore)}
            </span>
            <span className="text-black/60 dark:text-white/60">vs</span>
            <span style={{ color: rightTone.color }}>
              {formatSigned(rightScore)}
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-black/5 bg-white/50 px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
          <p className="text-micro uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
            {asset.label} drawdown gap
          </p>
          <p className="mt-1 font-mono text-lg text-[#14121a] dark:text-[#f2ede4]">
            {drawdownGap == null ? "—" : `${drawdownGap.toFixed(1)} pts`}
          </p>
        </div>
        <div className="rounded-xl border border-black/5 bg-white/50 px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
          <p className="text-micro uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
            Window lengths
          </p>
          <p className="mt-1 font-mono text-lg text-[#14121a] dark:text-[#f2ede4]">
            {left?.window?.start && left?.window?.end
              ? `${Math.round((Date.parse(left.window.end) - Date.parse(left.window.start)) / 86400000)}d`
              : "—"}
            <span className="text-black/60 dark:text-white/60"> / </span>
            {right?.window?.start && right?.window?.end
              ? `${Math.round((Date.parse(right.window.end) - Date.parse(right.window.start)) / 86400000)}d`
              : "—"}
          </p>
        </div>
      </div>
    </section>
  );
}

export default function ConvergencePage() {
  const { resolvedTheme } = useTheme();
  // false during SSR/hydration, true after: the server cannot know the theme, so
  // JS-computed colours switch to the resolved theme only once mounted.
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const isDark = !mounted || resolvedTheme !== "light";
  const [reloadKey, setReloadKey] = useState(0);
  const [windowsKey, setWindowsKey] = useState(0);
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });
  const [leftId, setLeftId] = useState("covid-shock");
  const [rightId, setRightId] = useState("crypto-winter");
  const [assetKey, setAssetKey] = useState("bitcoin");
  const [windows, setWindows] = useState({
    status: "loading",
    left: null,
    right: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/v1/regime/crypto-milestones", {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.detail ||
              payload?.error ||
              `Crypto milestone archive returned ${response.status}.`,
          );
        }
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload?.events) || payload.events.length < 2) {
          throw new Error("The crypto milestone archive is empty.");
        }
        setState({ status: "ready", data: payload, error: null });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setState({ status: "error", data: null, error: error.message });
        }
      });

    return () => controller.abort();
  }, [reloadKey]);

  const events = useMemo(() => state.data?.events ?? [], [state.data]);
  const leftEvent = useMemo(
    () => events.find((event) => event.id === leftId) ?? events[0] ?? null,
    [events, leftId],
  );
  const rightEvent = useMemo(
    () => events.find((event) => event.id === rightId) ?? events[1] ?? null,
    [events, rightId],
  );
  const asset = useMemo(() => getAssetTarget(assetKey), [assetKey]);

  useEffect(() => {
    if (!leftEvent || !rightEvent) return undefined;
    const controller = new AbortController();

    async function loadWindow(event) {
      const response = await fetch(
        `/api/v1/regime/macro-history?resolution=daily&start=${event.window.start}&end=${event.window.end}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          payload?.detail ||
            payload?.error ||
            `Daily window returned ${response.status}.`,
        );
      }
      const payload = await response.json();
      return Array.isArray(payload?.timeline) ? payload.timeline : [];
    }

    Promise.all([loadWindow(leftEvent), loadWindow(rightEvent)])
      .then(([left, right]) => {
        setWindows({
          status: "ready",
          left,
          right,
          error: null,
        });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          setWindows({
            status: "error",
            left: null,
            right: null,
            error: error.message,
          });
        }
      });

    return () => controller.abort();
  }, [leftEvent, rightEvent, windowsKey]);

  const handleRetryWindows = useCallback(() => {
    setWindows({
      status: "loading",
      left: null,
      right: null,
      error: null,
    });
    setWindowsKey((key) => key + 1);
  }, []);

  const handleRetry = useCallback(() => {
    setState({ status: "loading", data: null, error: null });
    setWindows({
      status: "loading",
      left: null,
      right: null,
      error: null,
    });
    setReloadKey((key) => key + 1);
  }, []);

  const handleLeftChange = useCallback((id) => {
    setLeftId(id);
    setWindows({
      status: "loading",
      left: null,
      right: null,
      error: null,
    });
  }, []);

  const handleRightChange = useCallback((id) => {
    setRightId(id);
    setWindows({
      status: "loading",
      left: null,
      right: null,
      error: null,
    });
  }, []);

  const swap = useCallback(() => {
    setLeftId(rightEvent?.id ?? "crypto-winter");
    setRightId(leftEvent?.id ?? "covid-shock");
    setWindows({
      status: "loading",
      left: null,
      right: null,
      error: null,
    });
  }, [leftEvent, rightEvent]);

  const windowStatus = (side) => {
    if (windows.status === "error") return "error";
    if (windows.status === "ready") return "ready";
    return side === "left" && windows.left ? "ready" : "loading";
  };

  return (
    <main className="relative h-full w-full overflow-y-auto overflow-x-hidden pb-24 pt-3 sm:pt-4">
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8">
        <header className="flex flex-col gap-4 pr-14 sm:pr-16 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-micro uppercase tracking-[0.2em] text-[#c0442f] dark:text-[#ff8b77]">
              Convergence
            </p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl lg:text-6xl">
              Two events. One macro lens.
            </h1>
            <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/70 dark:text-white/70 sm:text-body">
              Put a crypto crisis next to a macro crash. Compare the Core Index
              regime, the selected asset tape and the Sun / Moon / Saturn
              ephemeris at each peak. The astro layer is a historical lens, not
              a forecast.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={state.status} />
            <span className="inline-flex items-center rounded-full border border-black/5 bg-white/35 px-3 py-1.5 text-micro text-black/60 backdrop-blur-2xl dark:border-white/5 dark:bg-black/25 dark:text-white/60">
              {state.data?.events?.length ?? 7} curated windows ·{" "}
              {state.data?.as_of ?? "—"}
            </span>
          </div>
        </header>

        {state.status === "loading" ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {[0, 1].map((index) => (
              <div
                key={index}
                className="h-[560px] animate-pulse rounded-[1.6rem] border border-black/5 bg-white/45 dark:border-white/5 dark:bg-black/35"
              />
            ))}
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="mt-6 rounded-[1.6rem] border border-[#ef4444]/20 bg-white/45 p-5 dark:border-[#ef4444]/25 dark:bg-black/40 sm:p-6">
            <p className="text-micro uppercase tracking-[0.16em] text-[#c0442f] dark:text-[#ff8b77]">
              Event archive offline
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
              Could not load the convergence windows.
            </h2>
            <p className="mt-2 text-meta text-black/70 dark:text-white/70">
              {state.error}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-4 rounded-full border border-black/5 px-3.5 py-2 text-micro font-medium text-black/60 transition-colors hover:bg-black/[0.04] dark:border-white/5 dark:text-white/60 dark:hover:bg-white/[0.06]"
            >
              Retry event archive
            </button>
          </div>
        ) : null}

        {state.status === "ready" && state.data ? (
          <>
            <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-black/5 bg-white/45 p-3 backdrop-blur-2xl dark:border-white/5 dark:bg-black/30 sm:flex-row sm:items-center sm:justify-between sm:p-4">
              <div>
                <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
                  Compare through
                </p>
                <div
                  role="group"
                  aria-label="Comparison asset"
                  className="mt-1.5 inline-flex flex-wrap items-center gap-0.5 rounded-full border border-black/5 bg-black/[0.025] p-0.5 dark:border-white/5 dark:bg-white/[0.035]"
                >
                  {CONVERGENCE_ASSET_ORDER.map((key) => {
                    const target = ASSET_TARGETS[key];
                    const selected = key === assetKey;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAssetKey(key)}
                        aria-pressed={selected}
                        className={`rounded-full px-2.5 py-1 text-micro font-medium transition-colors ${
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
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-micro text-black/70 dark:text-white/70">
                  {leftEvent?.name ?? "—"}{" "}
                  <span className="text-black/60 dark:text-white/60">vs</span>{" "}
                  {rightEvent?.name ?? "—"}
                </span>
                <button
                  type="button"
                  onClick={swap}
                  className="inline-flex items-center gap-1.5 rounded-full border border-black/5 px-3 py-1.5 text-micro font-medium text-black/70 transition-colors hover:bg-black/[0.04] focus-visible:bg-black/4 dark:border-white/5 dark:text-white/70 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/6"
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
                    <path d="M7 7h11l-3-3M17 17H6l3 3" />
                  </svg>
                  Swap sides
                </button>
              </div>
            </div>

            <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
              <EventPanel
                side="Event A"
                event={leftEvent}
                events={events}
                onChange={handleLeftChange}
                timeline={windows.left}
                windowStatus={windowStatus("left")}
                windowError={windows.error}
                onRetryWindow={handleRetryWindows}
                assetKey={assetKey}
                asset={asset}
                isDark={isDark}
              />
              <EventPanel
                side="Event B"
                event={rightEvent}
                events={events}
                onChange={handleRightChange}
                timeline={windows.right}
                windowStatus={windowStatus("right")}
                windowError={windows.error}
                onRetryWindow={handleRetryWindows}
                assetKey={assetKey}
                asset={asset}
                isDark={isDark}
              />
            </div>

            <ComparisonRead
              left={leftEvent}
              right={rightEvent}
              assetKey={assetKey}
              asset={asset}
              isDark={isDark}
            />

            <details className="group mt-4 rounded-[1.4rem] border border-black/5 bg-white/45 p-5 backdrop-blur-2xl dark:border-white/5 dark:bg-black/25 sm:p-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-micro font-medium uppercase tracking-[0.16em] text-black/60 [&::-webkit-details-marker]:hidden dark:text-white/60">
                Method & limits
                <span className="text-base font-normal text-black/60 transition-transform group-open:rotate-45 dark:text-white/60">
                  +
                </span>
              </summary>
              <div className="mt-4 grid gap-4 text-meta leading-relaxed text-black/70 dark:text-white/70 sm:grid-cols-2">
                <p>
                  Event windows are hand-curated comparison windows, not
                  statistically detected crash dates. Core Index is the same
                  macro / volatility / momentum composite used on the Regime
                  tab; it is not a crypto-specific score.
                </p>
                <p>
                  Bitcoin prices are Blockchain.com daily market prices. Gold
                  is the World Bank London bullion benchmark; bonds are a
                  7.5-duration 10-year Treasury total-return proxy; Nifty 50 is
                  Yahoo Finance ^NSEI history from September 2007. The sky
                  positions are Lahiri sidereal ephemeris values at the event
                  peak.
                </p>
              </div>
              <p className="mt-4 border-t border-black/5 pt-3 text-micro text-black/60 dark:border-white/5 dark:text-white/60">
                Data version {state.data.as_of} · descriptive historical
                research. Not investment advice.
              </p>
            </details>
          </>
        ) : null}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new Event("strikehike:show-onboarding"),
              )
            }
            className="text-micro text-black/60 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#c0442f] focus-visible:text-[#c0442f] dark:text-white/60 dark:decoration-white/20 dark:hover:text-[#ff8b77] dark:focus-visible:text-[#ff8b77]"
          >
            How it works
          </button>
        </div>
      </div>
      <OnboardingModal />
    </main>
  );
}
