"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { panel } from "@/lib/motion";
import { RegimeDetailChart } from "@/components/regime/RegimeDetailChart";
import { SkyStrip } from "@/components/regime/SkyStrip";
import {
  addDaysIso,
  addMonthsIso,
  coreIndexTone,
  formatDate,
  formatNumber,
  formatSigned,
} from "@/components/regime/regimeUtils";

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-micro uppercase tracking-[0.12em] text-black/60 dark:text-white/60">
        {label}
      </p>
      <p className="mt-1 font-mono text-lg font-medium tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
        {value}
      </p>
    </div>
  );
}

function PreCrashCard({ label, data, isDark }) {
  const phase = data?.phase
    ? `${data.phase[0].toUpperCase()}${data.phase.slice(1)}`
    : "—";
  const coreIndex = data?.core_index;
  const tone = coreIndexTone(data?.core_index_bucket, isDark);

  return (
    <div className="rounded-2xl border border-black/5 p-4 dark:border-white/5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
          {label}
        </p>
        <p className="font-mono text-micro text-black/60 dark:text-white/60">
          {data?.as_of ? formatDate(data.as_of) : "No observation"}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Metric label="Core Index" value={formatSigned(coreIndex)} />
        <Metric
          label="Market level"
          value={formatNumber(data?.sp500_proxy, 2)}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3 text-micro dark:border-white/5">
        <span className="text-black/60 dark:text-white/60">
          Market was in {phase.toLowerCase()}
        </span>
        <span className="font-mono" style={{ color: tone.color }}>
          {tone.label} · {tone.action}
        </span>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-black/5 bg-black/[0.03] p-4 dark:border-white/5 dark:bg-white/[0.04]">
      <p className="text-micro uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
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
  const detailEnd = addDaysIso(addMonthsIso(crash.end, 1), -1);
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
      { signal: controller.signal },
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
      initial={reduceMotion ? false : panel.initial}
      animate={panel.animate}
      exit={
        reduceMotion
          ? { opacity: 0, transition: { duration: 0 } }
          : panel.exit
      }
      aria-label={`${crash.name} crash detail`}
      className="mt-4 scroll-mt-24 overflow-hidden rounded-[1.6rem] border border-(--sh-line-1) bg-white/45 dark:bg-black/25"
    >
      <div className="border-b border-black/5 p-5 dark:border-white/5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-micro uppercase tracking-[0.16em] text-[#c0442f] dark:text-[#ff8b77]">
              NBER recession ·{" "}
              {/* The range wraps as one piece, never inside "2009-06". */}
              <span className="whitespace-nowrap">
                {crash.start_month} → {crash.end_month}
              </span>
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl">
              {crash.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-black/60 dark:text-white/60">
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
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-black/5 text-black/60 transition-colors hover:bg-black/[0.04] hover:text-black/70 focus-visible:bg-black/[0.04] focus-visible:text-black/70 dark:border-white/5 dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white/70 dark:focus-visible:bg-white/[0.06] dark:focus-visible:text-white/70 sm:h-9 sm:w-9"
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
            isDark={isDark}
          />
          <PreCrashCard
            label="6 months prior"
            data={crash.pre_crash_indicators?.["6m"]}
            isDark={isDark}
          />
        </div>

        <div className="mt-5">
          {status === "loading" ? <DetailSkeleton /> : null}

          {status === "error" ? (
            <div className="rounded-2xl border border-[#ef4444]/25 bg-[#ef4444]/[0.04] p-4">
              <p className="text-meta font-medium text-[#c0442f] dark:text-[#ff8b77]">
                Daily window unavailable
              </p>
              <p className="mt-1 text-micro text-black/60 dark:text-white/60">
                {error}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="mt-3 rounded-full border border-black/5 px-3 py-1.5 text-micro font-medium text-black/60 transition-colors hover:bg-black/[0.04] focus-visible:bg-black/[0.04] dark:border-white/5 dark:text-white/60 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
              >
                Retry daily window
              </button>
            </div>
          ) : null}

          {status === "unavailable" ? (
            <div className="rounded-2xl border border-black/5 bg-black/[0.02] p-4 text-micro text-black/60 dark:border-white/5 dark:bg-white/[0.03] dark:text-white/60">
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
              <p className="mt-2 text-micro text-black/60 dark:text-white/60">
                {detail.point_count} daily observations ·{" "}
                {formatDate(detail.range?.start)} →{" "}
                {formatDate(detail.range?.end)}
              </p>
              <SkyStrip
                asOf={crash.start}
                contextLabel={`${crash.name} peak`}
                variant="footnote"
              />
            </>
          ) : null}
        </div>

        <p className="mt-4 text-micro leading-relaxed text-black/60 dark:text-white/60">
          The peak month is the NBER peak; USREC shading begins the following
          month. The two cards show the Core Index and market level three and
          six months before the peak. The sky strip is a historical ephemeris
          footnote, not an economic input.
        </p>
      </div>
    </motion.section>
  );
}
