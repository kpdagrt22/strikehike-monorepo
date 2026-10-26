"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { RegimeDetailChart } from "@/components/regime/RegimeDetailChart";
import {
  addDaysIso,
  addMonthsIso,
  formatDate,
  formatNumber,
  formatPercent,
  formatScore,
} from "@/components/regime/regimeUtils";

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-micro uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-medium tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
        {value}
      </p>
    </div>
  );
}

function PreCrashCard({ label, data }) {
  const inversion = data?.curve_inverted;
  const curveLabel =
    inversion == null
      ? "No curve data"
      : inversion
        ? "Inverted"
        : "Positive";
  const curveClass =
    inversion == null
      ? "border-black/5 text-black/45 dark:border-white/5 dark:text-white/45"
      : inversion
        ? "border-[#ef4444]/30 text-[#c0442f] dark:text-[#ff8b77]"
        : "border-[#0f766e]/25 text-[#0f766e] dark:text-[#5eead4]";

  return (
    <div className="rounded-2xl border border-black/5 bg-black/[0.02] p-4 dark:border-white/5 dark:bg-white/[0.03]">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/45 dark:text-white/45">
          {label}
        </p>
        <p className="font-mono text-micro text-black/35 dark:text-white/35">
          {data?.as_of ? formatDate(data.as_of) : "No observation"}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Metric label="Fed Funds" value={formatPercent(data?.fed_funds)} />
        <Metric label="10y–2y" value={formatPercent(data?.t10y2y)} />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-micro ${curveClass}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {curveLabel}
        </span>
        <span className="font-mono text-micro text-black/45 dark:text-white/45">
          Strength {data?.macro_strength != null
            ? `${formatScore(data.macro_strength)}/100`
            : "—"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3 text-micro text-black/40 dark:border-white/5 dark:text-white/40">
        <span>
          Equity proxy{" "}
          {data?.sp500_proxy != null
            ? formatNumber(data.sp500_proxy, 2)
            : "—"}
        </span>
        <span>Phase {data?.phase ?? "—"}</span>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-black/5 bg-black/[0.03] p-4 dark:border-white/5 dark:bg-white/[0.04]">
      <p className="text-micro uppercase tracking-[0.14em] text-black/35 dark:text-white/35">
        Loading the daily window
      </p>
      <div className="mt-4 h-[210px] rounded-xl bg-black/[0.05] dark:bg-white/[0.06]" />
    </div>
  );
}

export function CrashDetailPanel({ crash, isDark, onClose }) {
  const reduceMotion = useReducedMotion();
  const detailStart =
    crash.zoom_window?.start ?? addMonthsIso(crash.start, -6);
  const detailEnd = addDaysIso(addMonthsIso(crash.start, 1), -1);
  const canFetch = Boolean(
    crash.within_coverage && detailStart && detailEnd,
  );
  const [detail, setDetail] = useState(null);
  const [status, setStatus] = useState(
    canFetch ? "loading" : "unavailable",
  );
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!canFetch) return;

    const controller = new AbortController();

    fetch(
      `/api/v1/regime/macro-history?resolution=daily&start=${detailStart}&end=${detailEnd}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.detail ||
              payload?.error ||
              `Daily window returned ${response.status}.`,
          );
        }
        return response.json();
      })
      .then((payload) => {
        if (!Array.isArray(payload?.timeline)) {
          throw new Error("The daily window returned an unexpected payload.");
        }
        setDetail(payload);
        setStatus("ready");
      })
      .catch((loadError) => {
        if (loadError.name !== "AbortError") {
          setError(loadError.message);
          setStatus("error");
        }
      });

    return () => controller.abort();
  }, [canFetch, detailStart, detailEnd, reloadKey]);

  const handleRetry = () => {
    setDetail(null);
    setError(null);
    setStatus("loading");
    setReloadKey((key) => key + 1);
  };

  return (
    <motion.section
      layout
      initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={
        reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.99 }
      }
      transition={
        reduceMotion
          ? { duration: 0 }
          : { duration: 0.45, ease: [0.22, 1, 0.36, 1] }
      }
      aria-label={`${crash.name} crash detail`}
      className="mt-4 scroll-mt-24 overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/55 shadow-[0_18px_60px_rgba(20,18,26,0.14)] backdrop-blur-2xl dark:border-white/5 dark:bg-black/70 dark:shadow-[0_18px_60px_rgba(0,0,0,0.5)] lg:bg-white/45 lg:dark:bg-black/25"
    >
      <div className="border-b border-black/5 p-5 dark:border-white/5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-micro uppercase tracking-[0.16em] text-[#c0442f] dark:text-[#ff8b77]">
              NBER recession · {crash.start_month} → {crash.end_month}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl">
              {crash.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-black/45 dark:text-white/45">
              <span>
                {formatDate(crash.start)} → {formatDate(crash.end)}
              </span>
              <span aria-hidden="true">·</span>
              <span>{crash.duration_days} days</span>
              <span aria-hidden="true">·</span>
              <span>{crash.date_precision}-precise</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close crash detail"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-black/5 text-black/45 transition-colors hover:bg-black/[0.04] hover:text-black/70 dark:border-white/5 dark:text-white/45 dark:hover:bg-white/[0.06] dark:hover:text-white/70"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <PreCrashCard
            label="3 months prior"
            data={crash.pre_crash_indicators?.["3m"]}
          />
          <PreCrashCard
            label="6 months prior"
            data={crash.pre_crash_indicators?.["6m"]}
          />
        </div>

        <div className="mt-5">
          {status === "loading" ? <DetailSkeleton /> : null}

          {status === "error" ? (
            <div className="rounded-2xl border border-[#ef4444]/25 bg-[#ef4444]/[0.04] p-4">
              <p className="text-meta font-medium text-[#c0442f] dark:text-[#ff8b77]">
                Daily window unavailable
              </p>
              <p className="mt-1 text-micro text-black/45 dark:text-white/45">
                {error}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-3 rounded-full border border-black/5 px-3 py-1.5 text-micro font-medium text-black/60 transition-colors hover:bg-black/[0.04] dark:border-white/5 dark:text-white/60 dark:hover:bg-white/[0.06]"
              >
                Retry daily window
              </button>
            </div>
          ) : null}

          {status === "unavailable" ? (
            <div className="rounded-2xl border border-black/5 bg-black/[0.02] p-4 text-micro text-black/45 dark:border-white/5 dark:bg-white/[0.03] dark:text-white/45">
              This peak precedes the macro archive coverage. The pre-crash
              window is not available, but the NBER window is still shaded in
              the terminal.
            </div>
          ) : null}

          {status === "ready" && detail ? (
            <>
              <RegimeDetailChart
                timeline={detail.timeline}
                crash={crash}
                isDark={isDark}
              />
              <p className="mt-2 text-micro text-black/40 dark:text-white/40">
                {detail.point_count} daily observations ·{" "}
                {formatDate(detail.range?.start)} →{" "}
                {formatDate(detail.range?.end)}
              </p>
            </>
          ) : null}
        </div>

        <p className="mt-4 text-micro leading-relaxed text-black/40 dark:text-white/40">
          The peak month is the NBER peak; USREC shading begins the following
          month. Pre-crash values are the last observation on or before the
          3-month and 6-month dates.
        </p>
      </div>
    </motion.section>
  );
}
