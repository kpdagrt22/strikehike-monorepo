"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/components/regime/regimeUtils";

const BODIES = ["Sun", "Moon", "Saturn"];

function formatDegree(value) {
  const degree = Number(value);
  if (!Number.isFinite(degree)) return "—";
  return `${degree.toFixed(2)}°`;
}

export function AstroLens({ asOf, contextLabel, isDark }) {
  const [state, setState] = useState({
    status: "loading",
    bodies: null,
    error: null,
  });

  useEffect(() => {
    if (!asOf) return undefined;
    const controller = new AbortController();

    fetch(`/api/chrono/positions?date=${encodeURIComponent(asOf)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const error = new Error(
            payload?.error || `Sky service returned ${response.status}.`,
          );
          error.status = response.status;
          throw error;
        }
        return response.json();
      })
      .then((payload) => {
        setState({
          status: "ready",
          bodies: payload?.bodies ?? null,
          error: null,
        });
      })
      .catch((loadError) => {
        if (loadError.name === "AbortError") return;
        setState({
          status: "error",
          bodies: null,
          error: loadError.message,
        });
      });

    return () => controller.abort();
  }, [asOf]);

  return (
    <div
      className={`rounded-2xl border p-4 ${
        isDark
          ? "border-white/[0.08] bg-white/[0.025]"
          : "border-black/[0.06] bg-black/[0.018]"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/40 dark:text-white/40">
          Sky at peak
        </p>
        <p className="font-mono text-micro text-black/35 dark:text-white/35">
          {formatDate(asOf)} · {contextLabel}
        </p>
      </div>

      {state.status === "loading" ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {BODIES.map((name) => (
            <div
              key={name}
              className="h-16 animate-pulse rounded-xl bg-black/[0.04] dark:bg-white/[0.05]"
            />
          ))}
        </div>
      ) : null}

      {state.status === "error" ? (
        <p className="mt-3 text-micro text-[#c0442f] dark:text-[#ff8b77]">
          {state.error}
        </p>
      ) : null}

      {state.status === "ready" ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {BODIES.map((name) => {
            const body = state.bodies?.[name];
            const retrograde = body?.retro ?? body?.retrograde;
            return (
              <div
                key={name}
                className="rounded-xl border border-black/[0.05] bg-white/45 px-3 py-2.5 dark:border-white/[0.06] dark:bg-black/20"
              >
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-black/40 dark:text-white/40">
                    {name}
                  </p>
                  {retrograde ? (
                    <span
                      title="Retrograde"
                      className="text-[10px] text-[#c0442f] dark:text-[#ff8b77]"
                    >
                      ℞
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 font-mono text-lg font-medium tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4]">
                  {formatDegree(body?.lon ?? body?.degree)}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-black/40 dark:text-white/40">
                  {body?.nakshatra ?? "—"} · {body?.rashi ?? "—"}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className="mt-3 text-[10px] leading-relaxed text-black/35 dark:text-white/35">
        Lahiri sidereal ephemeris. A historical correspondence lens, not a
        causal input to the Bravos composite.
      </p>
    </div>
  );
}
