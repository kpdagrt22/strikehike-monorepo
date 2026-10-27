"use client";

import {
  coreIndexTone,
  formatDate,
  formatNumber,
  formatPercent,
  formatSigned,
} from "@/components/regime/regimeUtils";
import { PatternSparkline } from "@/components/patterns/PatternSparkline";

function Stat({ label, value, color }) {
  return (
    <div className="min-w-0">
      <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
        {label}
      </p>
      <p
        className="mt-0.5 truncate font-mono text-body font-medium tracking-[-0.02em] text-black/75 dark:text-white/80"
        style={color ? { color } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

export function PatternMarketCard({
  side,
  date,
  label,
  timeline,
  summary,
  isDark,
  accent,
  editorial,
}) {
  const tone = coreIndexTone(summary?.coreBucket, isDark);
  const move = summary?.change;
  const moveColor =
    move == null
      ? null
      : move >= 0
        ? isDark
          ? "#5eead4"
          : "#0f766e"
        : isDark
          ? "#fb7185"
          : "#c0442f";
  const drawdownColor =
    summary?.drawdown == null
      ? null
      : summary.drawdown < -10
        ? isDark
          ? "#fb7185"
          : "#c0442f"
        : isDark
          ? "#5eead4"
          : "#0f766e";

  return (
    <article className="overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/45 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-2xl dark:border-white/5 dark:bg-black/40 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
      <div className="border-b border-black/5 p-5 dark:border-white/5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p
              className="text-micro font-medium uppercase tracking-[0.18em]"
              style={{ color: accent }}
            >
              {side}
            </p>
            <h3 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-[#14121a] dark:text-[#f2ede4] sm:text-3xl">
              {label}
            </h3>
          </div>
          <span className="font-mono text-micro text-black/60 dark:text-white/60">
            {formatDate(date)}
          </span>
        </div>
        <p className="mt-2 text-micro text-black/60 dark:text-white/60">
          {summary?.source ?? "Market history"} · 12-month window
        </p>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
              Equity level
            </p>
            <p
              className="mt-1 font-mono text-[2.6rem] font-medium leading-[0.8] tracking-[-0.06em]"
              style={{ color: accent }}
            >
              {formatNumber(summary?.level, 0)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
              Market state
            </p>
            <p className="mt-1 text-meta font-semibold text-[#14121a] dark:text-[#f2ede4]">
              {summary?.state ?? "—"}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-black/5 pt-3 dark:border-white/5">
          <Stat
            label="12-month move"
            value={
              move == null
                ? "—"
                : `${move >= 0 ? "+" : ""}${formatPercent(move, 1)}`
            }
            color={moveColor}
          />
          <Stat
            label="Drawdown"
            value={formatPercent(summary?.drawdown, 1)}
            color={drawdownColor}
          />
          <Stat
            label="Phase"
            value={summary?.phase ?? "—"}
          />
        </div>

        <div className="mt-4">
          <PatternSparkline
            timeline={timeline}
            color={accent}
            isDark={isDark}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-3 dark:border-white/5">
          <span className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
            Core Index
          </span>
          {summary?.coreIndex == null ? (
            <span className="font-mono text-micro text-black/60 dark:text-white/60">
              {summary ? "Pre-index history" : "—"}
            </span>
          ) : (
            <span
              className="inline-flex items-baseline gap-2 font-mono text-micro"
              style={{ color: tone.color }}
            >
              {formatSigned(summary.coreIndex)}
              <span className="font-sans text-micro uppercase tracking-[0.12em]">
                {tone.label}
              </span>
            </span>
          )}
        </div>

        <p className="mt-4 text-meta leading-relaxed text-black/70 dark:text-white/70">
          {editorial}
        </p>
      </div>
    </article>
  );
}
