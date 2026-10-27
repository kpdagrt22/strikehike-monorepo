"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { AstroLens } from "@/components/regime/AstroLens";
import { ConvergenceMiniChart } from "@/components/regime/ConvergenceMiniChart";
import {
  CONVERGENCE_ASSET_ORDER,
  ASSET_TARGETS,
  assetChartColor,
  getAssetTarget,
} from "@/components/regime/assetTargets";
import {
  bravosTone,
  formatDate,
  formatNumber,
  formatPercent,
  formatSigned,
} from "@/components/regime/regimeUtils";

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

function BravosScale({ peak, trough, isDark }) {
  const peakTone = bravosTone(
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
  const troughTone = bravosTone(
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
            title={`Peak Bravos ${formatSigned(peak)}`}
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
            title={`Trough Bravos ${formatSigned(trough)}`}
          />
        ) : null}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-black/30 dark:text-white/30">
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
  assetKey,
  asset,
  isDark,
}) {
  const bravos = event?.bravos ?? {};
  const hasTrough = event?.trough != null;
  const headlineScore = hasTrough ? bravos.at_trough : bravos.at_peak;
  const headlineBucket = hasTrough
    ? bravos.at_trough_bucket
    : bravos.at_peak_bucket;
  const headlineTone = bravosTone(headlineBucket, isDark);
  const headlineLabel = hasTrough ? "Bravos at trough" : "Bravos at peak";
  const stats = event?.assets?.[assetKey] ?? null;
  const hasAsset = Boolean(stats?.available);
  const accent = assetChartColor(asset, isDark);

  return (
    <article className="overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/45 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-2xl dark:border-white/5 dark:bg-black/40 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
      <div className="border-b border-black/5 p-5 dark:border-white/5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <p className="text-micro font-medium uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
            {side} · {event?.category ?? "event"}
          </p>
          <span className="font-mono text-[10px] text-black/30 dark:text-white/30">
            {event?.window?.start} → {event?.window?.end}
          </span>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl">
              {event?.name ?? "Select an event"}
            </h2>
            <p className="mt-1 text-micro text-black/45 dark:text-white/45">
              {event?.tags?.join(" · ")}
            </p>
          </div>
          <label className="shrink-0">
            <span className="sr-only">Choose {side} event</span>
            <select
              value={event?.id ?? ""}
              onChange={(eventTarget) => onChange(eventTarget.target.value)}
              className="max-w-[15rem] rounded-full border border-black/5 bg-white/45 px-3 py-1.5 font-sans text-micro text-black/60 outline-none focus:border-[#c0442f]/40 dark:border-white/5 dark:bg-black/30 dark:text-white/60"
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
            <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/40 dark:text-white/40">
              {headlineLabel}
            </p>
            <div className="mt-2 flex items-end gap-2">
              <span
                className="font-mono text-[2.6rem] font-medium leading-[0.8] tracking-[-0.06em]"
                style={{ color: headlineTone.color }}
              >
                {formatSigned(headlineScore)}
              </span>
              <span className="pb-0.5 font-mono text-micro text-black/30 dark:text-white/30">
                / +50
              </span>
            </div>
            <p
              className="mt-2 text-micro font-medium"
              style={{ color: headlineTone.color }}
            >
              {headlineTone.label}
            </p>
            <BravosScale
              peak={bravos.at_peak}
              trough={bravos.at_trough}
              isDark={isDark}
            />
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-black/5 pt-2.5 dark:border-white/5">
              <span className="text-[10px] uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
                Peak reading
              </span>
              <span className="font-mono text-micro text-black/60 dark:text-white/60">
                {formatSigned(bravos.at_peak)}
              </span>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-black/35 dark:text-white/35">
              {formatDate(bravos.at_trough_date ?? bravos.at_peak_date)} event
              reading · {bravos.observations ?? 0} composite obs in window
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/40 dark:text-white/40">
                {asset.metricLabel} · event tape
              </p>
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                style={{
                  color: accent,
                  backgroundColor: `${accent}14`,
                }}
              >
                {asset.label}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-black/5 bg-white/35 px-3 py-2 dark:border-white/5 dark:bg-black/20">
                <p className="text-[10px] uppercase tracking-[0.1em] text-black/35 dark:text-white/35">
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
                <p className="text-[10px] uppercase tracking-[0.1em] text-black/35 dark:text-white/35">
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
                <div className="grid h-[150px] place-items-center rounded-xl border border-[#ef4444]/20 px-4 text-center text-micro text-[#c0442f] dark:text-[#ff8b77]">
                  {windowError || "Daily window unavailable."}
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
            <p className="mt-2 text-[10px] text-black/35 dark:text-white/35">
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
            isDark={isDark}
          />
        </div>

        <p className="mt-4 border-t border-black/5 pt-3 text-meta leading-relaxed text-black/55 dark:border-white/5 dark:text-white/55">
          {event?.summary}
        </p>
        <p className="mt-2 text-micro leading-relaxed text-black/40 dark:text-white/40">
          {event?.context}
        </p>
      </div>
    </article>
  );
}

function ComparisonRead({ left, right, assetKey, asset, isDark }) {
  const leftScore =
    left?.trough != null ? left?.bravos?.at_trough : left?.bravos?.at_peak;
  const rightScore =
    right?.trough != null
      ? right?.bravos?.at_trough
      : right?.bravos?.at_peak;
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
  const leftTone = bravosTone(
    left?.trough != null
      ? left?.bravos?.at_trough_bucket
      : left?.bravos?.at_peak_bucket,
    isDark,
  );
  const rightTone = bravosTone(
    right?.trough != null
      ? right?.bravos?.at_trough_bucket
      : right?.bravos?.at_peak_bucket,
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
        <p className="max-w-xl text-micro leading-relaxed text-black/45 dark:text-white/45">
          Bravos is a macro composite; the asset columns show how the same
          macro state travelled through {asset.label.toLowerCase()}. A high score
          is calm/constructive, not a directional prediction.
        </p>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <div className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
          <p className="text-[10px] uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
            Trough Bravos gap
          </p>
          <p className="mt-1 font-mono text-lg text-[#14121a] dark:text-[#f2ede4]">
            {scoreGap == null ? "—" : `${scoreGap.toFixed(1)} pts`}
          </p>
        </div>
        <div className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
          <p className="text-[10px] uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
            Trough readings
          </p>
          <p className="mt-1 flex items-center gap-2 font-mono text-lg">
            <span style={{ color: leftTone.color }}>
              {formatSigned(leftScore)}
            </span>
            <span className="text-black/20 dark:text-white/20">vs</span>
            <span style={{ color: rightTone.color }}>
              {formatSigned(rightScore)}
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
          <p className="text-[10px] uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
            {asset.label} drawdown gap
          </p>
          <p className="mt-1 font-mono text-lg text-[#14121a] dark:text-[#f2ede4]">
            {drawdownGap == null ? "—" : `${drawdownGap.toFixed(1)} pts`}
          </p>
        </div>
        <div className="rounded-xl border border-black/5 bg-black/[0.02] px-3 py-2.5 dark:border-white/5 dark:bg-white/[0.03]">
          <p className="text-[10px] uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
            Window lengths
          </p>
          <p className="mt-1 font-mono text-lg text-[#14121a] dark:text-[#f2ede4]">
            {left?.window?.start && left?.window?.end
              ? `${Math.round((Date.parse(left.window.end) - Date.parse(left.window.start)) / 86400000)}d`
              : "—"}
            <span className="text-black/20 dark:text-white/20"> / </span>
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
  const isDark = resolvedTheme !== "light";
  const [reloadKey, setReloadKey] = useState(0);
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
      cache: "no-store",
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
        { signal: controller.signal, cache: "no-store" },
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
  }, [leftEvent, rightEvent]);

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
    <main className="relative h-full w-full overflow-y-auto overflow-x-hidden pb-24 pt-20 sm:pt-24">
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-micro uppercase tracking-[0.2em] text-[#c0442f] dark:text-[#ff8b77]">
              Convergence
            </p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl lg:text-6xl">
              Two events. One macro lens.
            </h1>
            <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/55 dark:text-white/55 sm:text-body">
              Put a crypto crisis next to a macro crash. Compare the Bravos
              regime, the selected asset tape and the Sun / Moon / Saturn
              ephemeris at each peak. The astro layer is a historical lens, not
              a forecast.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={state.status} />
            <span className="inline-flex items-center rounded-full border border-black/5 bg-white/35 px-3 py-1.5 text-micro text-black/45 backdrop-blur-2xl dark:border-white/5 dark:bg-black/25 dark:text-white/45">
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
            <p className="mt-2 text-meta text-black/55 dark:text-white/55">
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
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-black/35 dark:text-white/35">
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
                    const color = assetChartColor(target, isDark);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAssetKey(key)}
                        aria-pressed={selected}
                        className={`rounded-full px-2.5 py-1 text-micro font-medium transition-colors ${
                          selected
                            ? ""
                            : "text-black/45 hover:text-black/75 dark:text-white/45 dark:hover:text-white/75"
                        }`}
                        style={
                          selected
                            ? {
                                color,
                                backgroundColor: `${color}1f`,
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
                <span className="text-micro text-black/40 dark:text-white/40">
                  {leftEvent?.name ?? "—"}{" "}
                  <span className="text-black/20 dark:text-white/20">vs</span>{" "}
                  {rightEvent?.name ?? "—"}
                </span>
                <button
                  type="button"
                  onClick={swap}
                  className="inline-flex items-center gap-1.5 rounded-full border border-black/5 px-3 py-1.5 text-micro font-medium text-black/55 transition-colors hover:bg-black/[0.04] dark:border-white/5 dark:text-white/55 dark:hover:bg-white/[0.06]"
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
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-micro font-medium uppercase tracking-[0.16em] text-black/50 [&::-webkit-details-marker]:hidden dark:text-white/50">
                Method & limits
                <span className="text-base font-normal text-black/30 transition-transform group-open:rotate-45 dark:text-white/30">
                  +
                </span>
              </summary>
              <div className="mt-4 grid gap-4 text-meta leading-relaxed text-black/55 dark:text-white/55 sm:grid-cols-2">
                <p>
                  Event windows are hand-curated comparison windows, not
                  statistically detected crash dates. Bravos is the same
                  macro / volatility / momentum composite used on the Regime
                  tab; it is not a crypto-specific score.
                </p>
                <p>
                  Bitcoin prices are Blockchain.com daily market prices. Gold
                  is the World Bank London bullion benchmark; bonds are a
                  7.5-duration 10-year Treasury total-return proxy. The sky
                  positions are Lahiri sidereal ephemeris values at the event
                  peak.
                </p>
              </div>
              <p className="mt-4 border-t border-black/5 pt-3 text-micro text-black/40 dark:border-white/5 dark:text-white/40">
                Data version {state.data.as_of} · descriptive historical
                research. Not investment advice.
              </p>
            </details>
          </>
        ) : null}
      </div>
    </main>
  );
}
