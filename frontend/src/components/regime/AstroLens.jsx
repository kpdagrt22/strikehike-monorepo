"use client";

/**
 * AstroLens: the Sun, Moon and Saturn at one date, as hairline rows (name and
 * degree on one line, nakshatra · pada · rashi under it, ℞ when retrograde).
 *
 * Props
 *   date          "YYYY-MM-DD"    Read through /api/chrono/positions?date= (the single-date
 *                                 contract) unless `bodies` is given.
 *   precision     "day" | "month" A month-precise date hides the Moon: on the 1st of a month
 *                                 its reading is arbitrary.
 *   label         string          The date line above the rows ("9 Oct 2007",
 *                                 "1 Sep 1906 · month start").
 *   showFootnote  bool            Render the ephemeris footnote; a page shows it once.
 *   unavailable   string?         The caller already knows the date is outside the ephemeris (e.g. a
 *                                 case's `sky.available === false`): show this quiet message and the
 *                                 "—" rows without asking the route.
 *   bodies        { Sun, Moon, Saturn }?  Positions already in hand ({ lon, retro }, optional
 *                                 nakshatra / rashi), e.g. the crosshair's range data. While given
 *                                 they are shown; `date` is still read once, so the lens falls back
 *                                 to it at once when `bodies` goes back to null.
 *
 * States: static placeholder rows while loading (no pulse); outside the ephemeris coverage the
 * rows read "—" with the route's own coverage message in quiet text; any other failure keeps
 * the message in signal ink with a Retry.
 */

import { useEffect, useState } from "react";
import { nakshatraOf, rashiOf } from "@/lib/astro/ephemeris";

const BODIES = ["Sun", "Moon", "Saturn"];
const FOOTNOTE =
  "Lahiri sidereal ephemeris. A historical correspondence lens, not a causal input to the Core Index composite.";

function formatDegree(value) {
  const degree = Number(value);
  if (!Number.isFinite(degree)) return "—";
  return `${degree.toFixed(2)}°`;
}

function placeName(body) {
  const lon = Number(body?.lon ?? body?.degree);
  const nakshatra = body?.nakshatra ?? (Number.isFinite(lon) ? nakshatraOf(lon) : null);
  const rashi = body?.rashi ?? (Number.isFinite(lon) ? rashiOf(lon) : null);
  if (!nakshatra && !rashi) return "—";
  return `${nakshatra ?? "—"} · ${rashi ?? "—"}`;
}

export function AstroLens({
  date,
  precision = "day",
  label,
  showFootnote = false,
  bodies = null,
  unavailable = null,
}) {
  const [state, setState] = useState({
    status: "loading",
    bodies: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!date || unavailable) return undefined;
    const controller = new AbortController();

    fetch(`/api/chrono/positions?date=${encodeURIComponent(date)}`, {
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
          // 422 is the route's coverage answer, not a fault.
          status: loadError.status === 422 ? "outside" : "error",
          bodies: null,
          error: loadError.message,
        });
      });

    return () => controller.abort();
  }, [date, unavailable, attempt]);

  const shown = bodies ?? state.bodies;
  const status = unavailable ? "outside" : bodies ? "ready" : state.status;
  const outsideMessage = unavailable ?? state.error;
  const monthOnly = precision === "month";

  return (
    <div className="min-w-0">
      <p className="pb-1.5 font-mono text-micro text-(--sh-text-3)">{label}</p>

      <div className="divide-y divide-(--sh-line-1) border-t border-(--sh-line-1)">
        {BODIES.map((name) => {
          if (name === "Moon" && monthOnly) {
            return (
              <p key={name} className="py-2 sm:py-[9px] text-micro text-(--sh-text-3)">
                <span className="font-medium uppercase tracking-[0.14em]">
                  Moon
                </span>{" "}
                — not shown for a month-precise date
              </p>
            );
          }
          const body = status === "ready" ? shown?.[name] : null;
          const retrograde = body?.retro ?? body?.retrograde;
          return (
            <div key={name} className="py-2 sm:py-[9px]">
              <div className="flex items-baseline justify-between gap-3">
                <p className="flex items-center gap-1 text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
                  {name}
                  {retrograde ? (
                    <span
                      title="Retrograde"
                      className="text-[#c0442f] dark:text-[#ff8b77]"
                    >
                      <span aria-hidden="true">℞</span>
                      <span className="sr-only">retrograde</span>
                    </span>
                  ) : null}
                </p>
                {/* Placeholders sit in line boxes of the same type as the
                    values, so the rows keep their height when the sky arrives. */}
                {status === "loading" ? (
                  <p className="font-mono text-body font-medium" aria-hidden="true">
                    <span className="inline-block h-[0.85em] w-14 rounded bg-(--sh-hover) align-middle" />
                  </p>
                ) : (
                  <p className="font-mono text-body font-medium tracking-[-0.02em] text-[#14121a] dark:text-[#f2ede4]">
                    {formatDegree(body?.lon ?? body?.degree)}
                  </p>
                )}
              </div>
              {status === "loading" ? (
                <p className="mt-0.5 text-micro" aria-hidden="true">
                  <span className="inline-block h-[0.9em] w-28 rounded bg-(--sh-hover) align-middle" />
                </p>
              ) : (
                <p className="mt-0.5 text-micro text-(--sh-text-3)">
                  {body ? placeName(body) : "—"}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {status === "loading" ? <p className="sr-only">Loading the sky</p> : null}
      {status === "outside" ? (
        <p className="mt-1.5 text-micro text-(--sh-text-3)">{outsideMessage}</p>
      ) : null}
      {status === "error" ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-micro text-[#c0442f] dark:text-[#ff8b77]">
          <p>{state.error}</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading", bodies: null, error: null });
              setAttempt((value) => value + 1);
            }}
            className="rounded-full border border-(--sh-line-2) px-2.5 py-0.5 font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) pointer-coarse:min-h-11"
          >
            Retry sky
          </button>
        </div>
      ) : null}

      {showFootnote ? (
        <p className="mt-3 text-micro leading-relaxed text-(--sh-text-3)">
          {FOOTNOTE}
        </p>
      ) : null}
    </div>
  );
}
