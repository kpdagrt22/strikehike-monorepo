"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/components/regime/regimeUtils";

const BODIES = ["Sun", "Moon", "Saturn"];

function formatDegree(value) {
  const degree = Number(value);
  if (!Number.isFinite(degree)) return "—";
  return `${degree.toFixed(2)}°`;
}

export function SkyStrip({ asOf, contextLabel }) {
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
    <section className="mt-3 flex flex-col gap-2 rounded-2xl border border-black/5 bg-white/45 px-4 py-3 backdrop-blur-2xl dark:border-white/5 dark:bg-black/40 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-micro font-medium uppercase tracking-[0.14em] text-black/40 dark:text-white/40">
          Sky at this date
        </span>
        <span className="font-mono text-micro text-black/60 dark:text-white/60">
          {formatDate(asOf)}
        </span>
        <span className="text-micro text-black/35 dark:text-white/35">
          · {contextLabel}
        </span>
      </div>

      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1"
        aria-live="polite"
      >
        {state.status === "loading" ? (
          <span className="text-micro text-black/40 dark:text-white/40">
            Reading the ephemeris…
          </span>
        ) : null}

        {state.status === "error" ? (
          <span className="text-micro text-[#c0442f] dark:text-[#ff8b77]">
            {state.error}
          </span>
        ) : null}

        {state.status === "ready"
          ? BODIES.map((name) => {
              const body = state.bodies?.[name];
              if (!body) return null;
              const retrograde = body.retro ?? body.retrograde;
              return (
                <span
                  key={name}
                  className="inline-flex items-baseline gap-1.5 font-mono text-micro text-black/55 dark:text-white/55"
                >
                  <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-black/35 dark:text-white/35">
                    {name}
                  </span>
                  <span>{formatDegree(body.lon ?? body.degree)}</span>
                  <span className="text-black/40 dark:text-white/40">
                    {body.nakshatra ?? "—"}
                  </span>
                  {retrograde ? (
                    <span
                      title="Retrograde"
                      className="text-[#c0442f] dark:text-[#ff8b77]"
                    >
                      ℞
                    </span>
                  ) : null}
                </span>
              );
            })
          : null}
      </div>
    </section>
  );
}
