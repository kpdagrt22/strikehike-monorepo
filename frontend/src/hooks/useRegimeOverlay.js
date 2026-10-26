"use client";

import { useEffect } from "react";
import { useChronoStore } from "@/store/chronoStore";

function shiftIsoDate(value, days) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Keeps the Orrery overlay state in sync with the focused date.
 *
 * The overlay is opt-in: when disabled this hook performs no request and leaves
 * the orbit rings on their base material. When enabled it asks for a seven-day
 * window so a date a few days beyond the latest FRED observation still resolves
 * to the most recent available state.
 */
export function useRegimeOverlay() {
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const regimeOverlay = useChronoStore((state) => state.regimeOverlay);

  useEffect(() => {
    const store = useChronoStore.getState();

    if (!regimeOverlay || !focusedDate) {
      if (store.regimeTone !== null) store.setRegimeTone(null);
      if (store.regimeOverlayStatus !== "idle") {
        store.setRegimeOverlayStatus("idle");
      }
      return undefined;
    }

    const controller = new AbortController();
    if (store.regimeOverlayStatus !== "loading") {
      store.setRegimeOverlayStatus("loading");
    }

    const start = shiftIsoDate(focusedDate, -7);
    if (!start) {
      store.setRegimeTone(null);
      store.setRegimeOverlayStatus("unavailable");
      return undefined;
    }

    fetch(
      `/api/v1/regime/macro-history?resolution=daily&start=${start}&end=${focusedDate}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        return response.json();
      })
      .then((payload) => {
        const points = Array.isArray(payload?.timeline)
          ? payload.timeline
          : [];
        const point = [...points]
          .reverse()
          .find(
            (item) =>
              item?.strength != null &&
              (item?.strength_coverage ?? 0) >= 0.99,
          );

        if (!point) {
          store.setRegimeTone(null);
          store.setRegimeOverlayStatus("unavailable");
          return;
        }

        const tone =
          point.strength >= 60
            ? "favorable"
            : point.strength <= 40
              ? "disruptive"
              : "neutral";
        store.setRegimeTone(tone);
        store.setRegimeOverlayStatus("ready");
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        store.setRegimeTone(null);
        store.setRegimeOverlayStatus(
          error.status === 422 ? "unavailable" : "error",
        );
      });

    return () => controller.abort();
  }, [focusedDate, regimeOverlay]);
}
