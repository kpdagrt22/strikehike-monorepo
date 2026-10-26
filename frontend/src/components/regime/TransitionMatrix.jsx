"use client";

import { useEffect, useMemo, useState } from "react";
import { formatDate } from "@/components/regime/regimeUtils";
import {
  getRegimeToneColor,
  getRegimeToneLabel,
} from "@/lib/regimeTone";

const FALLBACK_STATES = ["favorable", "neutral", "disruptive"];

function percent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

function duration(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1)} mo`;
}

export function TransitionMatrix({ isDark }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/regime/runs", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const error = new Error(
            payload?.detail ||
              `Transition matrix returned ${response.status}.`,
          );
          error.status = response.status;
          throw error;
        }
        return response.json();
      })
      .then((payload) => {
        if (!payload?.transitions?.probabilities) {
          throw new Error(
            "The transition matrix response is missing probabilities.",
          );
        }
        setState({ status: "ready", data: payload, error: null });
      })
      .catch((loadError) => {
        if (loadError.name === "AbortError") return;
        setState({
          status: "error",
          data: null,
          error: loadError.message,
        });
      });

    return () => controller.abort();
  }, [reloadKey]);

  const matrix = useMemo(() => {
    if (state.status !== "ready" || !state.data) return null;
    const data = state.data;
    const states =
      Array.isArray(data.states) && data.states.length
        ? data.states
        : FALLBACK_STATES;
    const transitions = data.transitions;
    const probabilities = transitions.probabilities;
    const medians = transitions.median_duration_months ?? {};
    const runCounts = transitions.run_counts ?? {};

    return {
      data,
      states,
      probabilities,
      medians,
      runCounts,
      sample: data.sample,
    };
  }, [state]);

  const handleRetry = () => {
    setState({ status: "loading", data: null, error: null });
    setReloadKey((key) => key + 1);
  };

  return (
    <section
      aria-labelledby="transition-matrix-title"
      className="overflow-hidden rounded-[1.6rem] border border-black/10 bg-white/60 shadow-[0_18px_60px_rgba(20,18,26,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-black/40 dark:shadow-[0_18px_60px_rgba(0,0,0,0.45)]"
    >
      <div className="border-b border-black/[0.07] p-5 dark:border-white/10 sm:p-6">
        <p className="text-micro uppercase tracking-[0.18em] text-[#c0442f] dark:text-[#ff8b77]">
          Transition matrix
        </p>
        <h2
          id="transition-matrix-title"
          className="mt-1 text-xl font-semibold tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4] sm:text-2xl"
        >
          Monthly regime persistence
        </h2>
        <p className="mt-1 text-micro text-black/45 dark:text-white/45">
          Rows: current state · Columns: next state
          {matrix?.sample
            ? ` · ${formatDate(matrix.sample.start)} → ${formatDate(matrix.sample.end)}`
            : ""}
        </p>
      </div>

      {state.status === "loading" ? (
        <div className="p-5 sm:p-6">
          <div className="h-[210px] animate-pulse rounded-2xl bg-black/[0.04] dark:bg-white/[0.05]" />
          <p className="mt-3 text-micro text-black/40 dark:text-white/40">
            Reading the serialized transition statistics…
          </p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="p-5 sm:p-6">
          <div className="rounded-2xl border border-[#ef4444]/25 bg-[#ef4444]/[0.04] p-4">
            <p className="text-meta font-medium text-[#c0442f] dark:text-[#ff8b77]">
              Transition matrix unavailable
            </p>
            <p className="mt-1 text-micro text-black/45 dark:text-white/45">
              {state.error}
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-3 rounded-full border border-black/10 px-3 py-1.5 text-micro font-medium text-black/60 transition-colors hover:bg-black/[0.04] dark:border-white/10 dark:text-white/60 dark:hover:bg-white/[0.06]"
            >
              Retry matrix
            </button>
          </div>
        </div>
      ) : null}

      {matrix ? (
        <>
          <div className="hidden overflow-x-auto p-4 sm:block sm:p-5">
            <table className="w-full border-separate border-spacing-1 text-micro">
              <thead>
                <tr>
                  <th className="w-[8.5rem] px-2 py-2 text-left text-micro font-medium uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
                    From
                  </th>
                  {matrix.states.map((target) => (
                    <th
                      key={`column-${target}`}
                      className="px-2 py-2 text-center text-micro font-medium tracking-[0.02em]"
                      style={{
                        color:
                          getRegimeToneColor(target, isDark) ??
                          "currentColor",
                      }}
                    >
                      {getRegimeToneLabel(target) ?? target}
                    </th>
                  ))}
                  <th className="w-[9rem] px-2 py-2 text-right text-micro font-medium uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
                    Median run
                  </th>
                </tr>
              </thead>
              <tbody>
                {matrix.states.map((from) => (
                  <tr key={`row-${from}`}>
                    <th
                      scope="row"
                      className="px-2 py-2.5 text-left text-micro font-medium text-black/65 dark:text-white/65"
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              getRegimeToneColor(from, isDark) ??
                              "#9ca3af",
                          }}
                        />
                        {getRegimeToneLabel(from) ?? from}
                      </span>
                    </th>
                    {matrix.states.map((to) => {
                      const probability =
                        matrix.probabilities[from]?.[to];
                      const color =
                        getRegimeToneColor(to, isDark) ?? "#9ca3af";
                      const alpha = Math.round(
                        Math.min(1, Math.max(0, probability ?? 0)) *
                          0.34 *
                          255,
                      )
                        .toString(16)
                        .padStart(2, "0");
                      return (
                        <td
                          key={`${from}-${to}`}
                          className="rounded-xl border border-black/[0.06] px-2 py-2.5 text-center font-mono text-body text-[#14121a] dark:border-white/[0.08] dark:text-[#f2ede4]"
                          style={{
                            backgroundColor: `${color}${alpha}`,
                          }}
                        >
                          {percent(probability)}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono text-micro text-black/55 dark:text-white/55">
                      {duration(matrix.medians[from])}
                      <span className="ml-1.5 text-black/30 dark:text-white/30">
                        · {matrix.runCounts[from] ?? 0} runs
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 p-4 sm:hidden">
            {matrix.states.map((from) => (
              <div
                key={`mobile-${from}`}
                className="rounded-2xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-micro font-medium text-black/65 dark:text-white/65">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor:
                          getRegimeToneColor(from, isDark) ?? "#9ca3af",
                      }}
                    />
                    {getRegimeToneLabel(from) ?? from}
                  </span>
                  <span className="font-mono text-micro text-black/40 dark:text-white/40">
                    {duration(matrix.medians[from])} ·{" "}
                    {matrix.runCounts[from] ?? 0} runs
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {matrix.states.map((to) => {
                    const probability = matrix.probabilities[from]?.[to];
                    const color =
                      getRegimeToneColor(to, isDark) ?? "#9ca3af";
                    const alpha = Math.round(
                      Math.min(1, Math.max(0, probability ?? 0)) *
                        0.3 *
                        255,
                    )
                      .toString(16)
                      .padStart(2, "0");
                    return (
                      <div
                        key={`mobile-${from}-${to}`}
                        className="rounded-lg border border-black/[0.06] px-2 py-1.5 text-center dark:border-white/[0.08]"
                        style={{ backgroundColor: `${color}${alpha}` }}
                      >
                        <p className="text-[10px] uppercase tracking-[0.08em] text-black/40 dark:text-white/40">
                          {(getRegimeToneLabel(to) ?? to).slice(0, 3)}
                        </p>
                        <p className="font-mono text-meta text-[#14121a] dark:text-[#f2ede4]">
                          {percent(probability)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-black/[0.07] px-4 py-3 text-micro leading-relaxed text-black/40 dark:border-white/10 dark:text-white/40">
            Includes self-transitions. Median run lengths are monthly
            observations with full composite coverage
            {matrix.sample
              ? ` (${matrix.sample.observations} obs)`
              : ""}. Strength bands: Favorable ≥ 60, Neutral 40–60,
            Disruptive ≤ 40.
          </div>
        </>
      ) : null}
    </section>
  );
}
