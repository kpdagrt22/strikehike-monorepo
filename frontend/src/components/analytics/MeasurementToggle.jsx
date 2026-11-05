"use client";

import { useEffect, useRef, useState } from "react";
import { flushAnalytics, resetIdentity } from "@/lib/analytics/track";

const KEY = "strikehike:analytics:v1";
const OPTOUT = "strikehike:analytics:optout";
const ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "1";

// Everything below reads the browser, so it runs after mount only: the
// server render (and the first client render) show a neutral, inert switch.
function readState() {
  let out = false;
  let id = null;
  try {
    out = window.localStorage.getItem(OPTOUT) === "1";
    const value = JSON.parse(window.localStorage.getItem(KEY) || "null");
    id = typeof value?.aid === "string" ? value.aid : null;
  } catch {
    // Storage blocked: the tracker counts this visit with a temporary ID.
  }
  const blocked =
    navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  return { out, id, blocked };
}

export function MeasurementToggle() {
  const [state, setState] = useState(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  useEffect(() => {
    const queued = window.setTimeout(() => setState(readState()), 0);
    return () => {
      window.clearTimeout(queued);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const ready = state !== null;
  const blocked = Boolean(state?.blocked);
  const id = state?.id ?? null;
  const counting = ready && ENABLED && !blocked && !state.out;
  const status = !ready
    ? ""
    : blocked
      ? "Not counted: your browser asks sites not to track"
      : counting
        ? "Counting this browser"
        : "Not counted";

  const toggle = () => {
    if (!ready || blocked || !ENABLED) return;
    const out = !state.out;
    let nextId = null;
    try {
      if (out) {
        window.localStorage.setItem(OPTOUT, "1");
        window.localStorage.removeItem(KEY);
        // Opted out now, so this discards anything still queued.
        flushAnalytics();
      } else {
        window.localStorage.removeItem(OPTOUT);
        nextId = resetIdentity().aid;
      }
    } catch {
      return;
    }
    setState({ ...state, out, id: nextId });
    setCopied(false);
  };

  const copy = async () => {
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby="privacy-measurement-heading" className="mt-6 border-t border-(--sh-line-1) pt-5">
      <h2 id="privacy-measurement-heading" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
        Privacy and measurement
      </h2>
      <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
        StrikeHike counts visits with its own measurement, on its own server.
        Nothing is sent to another company, and there are no cookies or ads.
      </p>
      <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
        What is counted: the pages you open and what you open on them; how long a
        page was visible and how fast it loaded; your screen-size class (phone,
        tablet or desktop); your browser and system type; a region taken from
        your time zone (India, US, EU, UK or other); the name of the site that
        linked you here; and an anonymous random ID kept in this browser.
      </p>
      <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
        What is never collected: your IP address, your name or email, anything
        you type, or the exact dates you move to.
      </p>
      <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
        Raw records are deleted after 13 months. If your browser sends Global
        Privacy Control or Do Not Track, nothing is counted.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={counting}
          disabled={!ready || blocked || !ENABLED}
          onClick={toggle}
          className="inline-flex min-h-11 items-center gap-2.5 rounded-full border border-(--sh-line-2) px-3 text-meta font-medium text-(--sh-text-1) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) disabled:cursor-not-allowed disabled:opacity-[0.38]"
        >
          <span
            aria-hidden="true"
            className={`relative h-6 w-11 rounded-full transition-colors ${
              counting ? "bg-(--sh-text-1)" : "bg-(--sh-line-2)"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-(--sh-surface-overlay) shadow-(--sh-shadow-float) transition-transform motion-reduce:transition-none ${
                counting ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </span>
          Count my visits
        </button>
        <span aria-live="polite" className="text-meta text-(--sh-text-2)">
          {status}
        </span>
      </div>

      {counting ? (
        <div className="mt-3 space-y-2 text-meta text-(--sh-text-2)">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-(--sh-text-1)">
              Anonymous ID: {id ? `${id.slice(0, 8)}…` : "—"}
            </span>
            <button
              type="button"
              onClick={copy}
              disabled={!id}
              className="min-h-11 rounded-full border border-(--sh-line-2) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) disabled:opacity-[0.38]"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p>
            To have its records deleted, send this ID to KP with the feedback
            form.
          </p>
        </div>
      ) : null}
    </section>
  );
}
