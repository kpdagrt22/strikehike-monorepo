"use client";

import { useEffect, useSyncExternalStore } from "react";
import { experimentExposed } from "@/lib/analytics/events";
import { experimentById, type ExperimentId } from "./config";
import { ANONYMOUS_ID, OVERRIDE_PARAM, parseOverride, resolveExperiment, type Assignment } from "./assign";

// The analytics id lives in this key, written by lib/analytics/track.ts. The
// experiments module reads it directly rather than importing track.ts, so the
// tracker stays inside its byte budget.
const IDENTITY_KEY = "strikehike:analytics:v1";
const EXPOSED_PREFIX = "sh.exp:";

function readAnonymousId(): string | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { aid?: unknown };
    return typeof value?.aid === "string" && ANONYMOUS_ID.test(value.aid) ? value.aid : null;
  } catch {
    return null;
  }
}

function readOverride() {
  try {
    return parseOverride(new URLSearchParams(window.location.search).get(OVERRIDE_PARAM));
  } catch {
    return null;
  }
}

// getSnapshot must return a referentially stable value, so each id's assignment
// is resolved once and cached. Nothing here reads user data across requests: the
// server snapshot is the same constant control for every visitor.
const cache = new Map<string, Assignment>();

function resolveFor(id: ExperimentId): Assignment {
  const cached = cache.get(id);
  if (cached) return cached;
  const experiment = experimentById(id)!;
  const next = resolveExperiment(experiment, readAnonymousId(), readOverride());
  cache.set(id, next);
  return next;
}

function controlFor(id: ExperimentId): Assignment {
  const key = `server:${id}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const experiment = experimentById(id)!;
  const value: Assignment = {
    variant: experiment.variants[0],
    isControl: true,
    track: false,
  };
  cache.set(key, value);
  return value;
}

// The assignment only changes when the stored id or the URL changes, neither of
// which happens inside a page view, so there is nothing to subscribe to.
const nothing = () => () => {};

const reported = new Set<string>();

// Once per session per experiment. sessionStorage is the source of truth across
// remounts; the module set covers a browser that blocks sessionStorage.
function firstExposure(experimentId: string): boolean {
  const key = `${EXPOSED_PREFIX}${experimentId}`;
  try {
    if (window.sessionStorage.getItem(key) === "1") return false;
    window.sessionStorage.setItem(key, "1");
    return true;
  } catch {
    if (reported.has(experimentId)) return false;
    reported.add(experimentId);
    return true;
  }
}

/**
 * The variant this screen should show. The server and the first client render
 * always paint the control, so the markup is identical for every visitor and
 * hydration matches; the browser then resolves the real assignment and swaps
 * only the controlled text. An active experiment, or a forced `?exp` variant,
 * reports one `experiment_exposed` per session.
 */
export function useExperiment(id: ExperimentId): Assignment {
  const assignment = useSyncExternalStore(
    nothing,
    () => resolveFor(id),
    () => controlFor(id),
  );

  useEffect(() => {
    if (assignment.track && firstExposure(id)) {
      experimentExposed(id, assignment.variant);
    }
  }, [id, assignment.track, assignment.variant]);

  return assignment;
}
