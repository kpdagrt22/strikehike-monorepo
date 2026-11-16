"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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

// Where the hint sits. Its resting place is CSS: above the dock, between the
// feedback and support buttons (bottom-[8.5rem] on phones, sm:bottom-24). On a
// short or narrow screen, or with larger text spacing, the gauge's text can
// reach down into that place. The hint then sits just below the gauge instead,
// and when the full sentence does not fit there above the dock and the date
// strip, it shortens to one line. It never covers the gauge.
const GAP = 6;
const RESTING_BOTTOM_PHONE = 136; // bottom-[8.5rem]
const RESTING_BOTTOM_WIDE = 96; // sm:bottom-24
const GAUGE = '[data-hud="gauge"]';
const BELOW = ['[data-hud="dock"]', '[data-hud="timeline"]'];
const WATCHED = [GAUGE, "[data-home-intro]", ...BELOW];

function boxOf(selector) {
  const element = document.querySelector(selector);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  return box.width >= 1 && box.height >= 1 ? box : null;
}

/** null: the resting place is clear. Otherwise the top below the gauge, and
 *  whether the full hint is too tall for the room left there. */
function slotFor(hint, fullHeight) {
  const gauge = boxOf(GAUGE);
  if (!gauge || !fullHeight) return null;
  const viewport = document.documentElement.clientHeight;
  const wide = window.matchMedia("(min-width: 640px)").matches;
  const restingTop =
    viewport - (wide ? RESTING_BOTTOM_WIDE : RESTING_BOTTOM_PHONE) - fullHeight;
  const { left, right } = hint.getBoundingClientRect();
  if (
    restingTop >= gauge.bottom + GAP ||
    right <= gauge.left ||
    left >= gauge.right
  ) {
    return null;
  }
  const top = Math.round(gauge.bottom + GAP);
  let limit = viewport;
  for (const selector of BELOW) {
    const box = boxOf(selector);
    if (box && box.top > top && box.right > left && box.left < right) {
      limit = Math.min(limit, box.top);
    }
  }
  return { top, compact: top + fullHeight > limit - GAP };
}

const sameSlot = (a, b) =>
  a === b || (a && b && a.top === b.top && a.compact === b.compact);

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
  const hintRef = useRef(null);
  const fullHeight = useRef(0);
  const [slot, setSlot] = useState(null);

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

  // Measured in an animation frame after mount, then again whenever the gauge
  // moves or anything around the hint changes size (text spacing, the intro,
  // the dock). Reading layout in a frame, not in a layout effect, keeps the
  // read out of the hydration commit: the resting place is the usual answer,
  // so the hint does not move at all in the common case.
  useEffect(() => {
    const hint = hintRef.current;
    if (!visible || !hint) return undefined;
    let frame = 0;
    const place = () => {
      frame = 0;
      // The full hint's height is what decides; the short one never sets it.
      if (!hint.hasAttribute("data-hint-compact")) {
        fullHeight.current = hint.offsetHeight;
      }
      const next = slotFor(hint, fullHeight.current);
      setSlot((previous) => (sameSlot(previous, next) ? previous : next));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(place);
    };
    // A new width can change the full hint's height: show it again to measure.
    const resized = () => {
      setSlot(null);
      schedule();
    };
    schedule();
    const sizes = new ResizeObserver(schedule);
    sizes.observe(hint);
    for (const selector of WATCHED) {
      const element = document.querySelector(selector);
      if (element) sizes.observe(element);
    }
    // The gauge's top is an inline style set from the measured stage.
    const moves = new MutationObserver(schedule);
    const gauge = document.querySelector(GAUGE);
    if (gauge) moves.observe(gauge, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", resized);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      sizes.disconnect();
      moves.disconnect();
      window.removeEventListener("resize", resized);
    };
  }, [visible]);

  if (!visible) return null;
  const compact = slot?.compact === true;

  return (
    <div
      ref={hintRef}
      data-home-hint
      data-hint-place={slot ? "below-gauge" : "resting"}
      data-hint-compact={compact ? "" : undefined}
      style={slot ? { top: `${slot.top}px`, bottom: "auto" } : undefined}
      className={`pointer-events-auto fixed bottom-[8.5rem] left-1/2 z-40 flex w-[calc(100vw-8rem)] -translate-x-1/2 items-center rounded-full border border-(--sh-line-1) bg-(--sh-surface-overlay) text-meta leading-snug text-(--sh-text-2) shadow-(--sh-shadow-float) backdrop-blur-xl sm:bottom-24 sm:w-[21rem] ${
        compact ? "justify-center" : "gap-2 py-1.5 pl-4 pr-1.5"
      }`}
    >
      {compact ? (
        // Where only one line fits: the whole pill is the dismiss button.
        <button
          type="button"
          onClick={() => close("enter")}
          className="flex min-h-7 w-full items-center justify-center gap-1.5 rounded-full px-3 py-1 transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) focus-visible:text-(--sh-text-1)"
        >
          <span>Drag the sky.</span>
          <svg
            viewBox="0 0 16 16"
            className="h-2.5 w-2.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>{" "}
          <span className="sr-only">Dismiss hint</span>
        </button>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
