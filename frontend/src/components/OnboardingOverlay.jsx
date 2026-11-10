"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { onboardingDismissed } from "@/lib/analytics/events";
import { useMounted } from "@/hooks/useMounted";

const STORAGE_KEY = "hasSeenIntro";
const subscribe = () => () => {};

function hasSeen() {
  try {
    return Boolean(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

const serverHasSeen = () => false;

/**
 * One first-visit hint, in place of the old multi-step modal. It does not block
 * the scene and never returns once dismissed in this browser.
 */
export function OnboardingOverlay() {
  const mounted = useMounted();
  const seen = useSyncExternalStore(subscribe, hasSeen, serverHasSeen);
  const [dismissed, setDismissed] = useState(false);
  // Render nothing until the browser has read storage: the server cannot know
  // whether this is a returning visit, so showing the hint in the HTML would
  // flash it once per load for people who already dismissed it.
  const visible = mounted && !seen && !dismissed;

  const close = useCallback((method) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Storage can be unavailable in privacy modes; the hint still closes.
    }
    onboardingDismissed(method);
    window.dispatchEvent(new Event("strikehike:intro-dismissed"));
    setDismissed(true);
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close("escape");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, close]);

  if (!visible) return null;

  return (
    <div
      data-home-hint
      className="pointer-events-auto fixed bottom-[8.5rem] left-1/2 z-40 flex w-[calc(100vw-8rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-(--sh-line-1) bg-(--sh-surface-overlay) py-1.5 pl-4 pr-1.5 text-meta leading-snug text-(--sh-text-2) shadow-(--sh-shadow-float) backdrop-blur-xl sm:bottom-24 sm:w-[21rem]"
    >
      <p className="min-w-0 flex-1">
        Drag to turn the sky. Pick a date below.
      </p>
      <button
        type="button"
        onClick={() => close("enter")}
        aria-label="Dismiss hint"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) focus-visible:text-(--sh-text-1)"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
