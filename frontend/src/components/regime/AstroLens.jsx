"use client";

import { useEffect, useState } from "react";
import { formatDate } from "@/components/regime/regimeUtils";

const BODIES = ["Sun", "Moon", "Saturn"];

function formatDegree(value) {
  const degree = Number(value);
  if (!Number.isFinite(degree)) return "—";
  return `${degree.toFixed(2)}°`;
}

export function AstroLens({ asOf, contextLabel }) {
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
    <div className="rounded-2xl border border-black/[0.06] bg-black/[0.018] p-4 dark:border-white/[0.08] dark:bg-white/[0.025]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
          Sky at peak
        </p>
        <p className="font-mono text-micro text-black/60 dark:text-white/60">
          {formatDate(asOf)} · {contextLabel}
        </p>
      </div>

      {state.status === "loading" ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {BODIES.map((name) => (
            <div
              key={name}
              className="h-12 animate-pulse rounded-xl bg-black/[0.04] dark:bg-white/[0.05] sm:h-16"
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
        // Phones: hairline rows (name and degree on one line, Nakshatra under
        // it). From sm: three columns on hairlines. Nakshatra names wrap, never truncate.
        <div className="mt-3 divide-(--sh-line-1) max-sm:divide-y sm:grid sm:grid-cols-3 sm:divide-x">
          {BODIES.map((name) => {
            const body = state.bodies?.[name];
            const retrograde = body?.retro ?? body?.retrograde;
            return (
              <div
                key={name}
                className="max-sm:py-2.5 max-sm:first:pt-0 max-sm:last:pb-0 sm:px-4 sm:first:pl-0 sm:last:pr-0"
              >
                <div className="flex items-baseline justify-between gap-3 sm:block">
                  <div className="flex items-center gap-1 sm:justify-between">
                    <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
                      {name}
                    </p>
                    {retrograde ? (
                      <span
                        title="Retrograde"
                        className="text-micro text-[#c0442f] dark:text-[#ff8b77]"
                      >
                        <span aria-hidden="true">℞</span>
                        <span className="sr-only">retrograde</span>
                      </span>
                    ) : null}
                  </div>
                  <p className="font-mono text-lg font-medium tracking-[-0.03em] text-[#14121a] dark:text-[#f2ede4] sm:mt-1">
                    {formatDegree(body?.lon ?? body?.degree)}
                  </p>
                </div>
                <p className="mt-0.5 text-micro text-black/60 dark:text-white/60">
                  {body?.nakshatra ?? "—"} · {body?.rashi ?? "—"}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}

      <p className="mt-3 text-micro leading-relaxed text-black/60 dark:text-white/60">
        Lahiri sidereal ephemeris. A historical correspondence lens, not a
        causal input to the Core Index composite.
      </p>
    </div>
  );
}
