"use client";

import { useEffect, useState } from "react";

// The HUD boxes that own screen space on the home page. The orrery is fitted
// between them, so every one is measured rather than assumed: they appear,
// move and change height with the viewport, the visit and the open panels.
const BOXES = {
  gauge: '[data-hud="gauge"]',
  aura: ".sh-aura",
  intro: "[data-home-intro]",
  left: "[data-home-left-column]",
  right: "#chrono-alignment-sheet",
  timeline: '[data-hud="timeline"]',
  dock: '[data-hud="dock"]',
  hint: "[data-home-hint]",
  feedback: "[data-home-feedback]",
  sponsor: "[data-home-sponsor]",
  view: '[data-hud="view-controls"]',
};

const FALLBACK_TOP = 76; // the header row, when nothing else is above the scene
const GAP = 12;
const EDGE = 12;

function rectOf(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function visible(element) {
  if (!element) return false;
  if (element.closest("[inert]")) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function measure() {
  const width = document.documentElement.clientWidth;
  const height = document.documentElement.clientHeight;
  const boxes = {};
  for (const [key, selector] of Object.entries(BOXES)) {
    const element = document.querySelector(selector);
    boxes[key] = visible(element) ? rectOf(element) : null;
  }

  let left = EDGE;
  if (boxes.left) left = Math.max(left, boxes.left.right + GAP);
  let right = width - EDGE;
  if (boxes.right) right = Math.min(right, boxes.right.left - GAP);

  let top = FALLBACK_TOP;
  if (boxes.gauge) top = Math.max(top, boxes.gauge.bottom + GAP);
  // The flame aura is larger than the gauge's box; it owns that space too.
  if (boxes.aura) top = Math.max(top, boxes.aura.bottom + GAP);
  // The intro sits above the left column; when it reaches into the free width,
  // the scene starts below it.
  if (boxes.intro && boxes.intro.right > left + 4) {
    top = Math.max(top, boxes.intro.bottom + GAP);
  }

  let bottom = height - EDGE;
  for (const key of ["timeline", "dock", "hint", "feedback", "sponsor", "view"]) {
    if (boxes[key]) bottom = Math.min(bottom, boxes[key].top - GAP);
  }

  // The gauge's own top: below the intro until the lg layout puts the intro in
  // the left column. Measured here so the HUD never has to guess its height.
  let gaugeTop = null;
  if (width < 1024) {
    gaugeTop = Math.max(
      FALLBACK_TOP,
      boxes.intro ? boxes.intro.bottom + 10 : FALLBACK_TOP,
    );
  }
  if (right - left < 140 || bottom - top < 90) {
    // A panel-heavy viewport: keep the measured edges (never grow over an
    // overlay). The scene shrinks instead.
    return {
      left: width < 1024 ? EDGE : Math.min(left, width - 340),
      right,
      top: Math.max(top, FALLBACK_TOP),
      bottom: Math.max(bottom, Math.max(top, FALLBACK_TOP) + 8),
      gaugeTop,
      width,
      height,
    };
  }
  return { left, right, top, bottom, gaugeTop, width, height };
}

/**
 * The measured free area between the HUD, kept current on resize, when a panel
 * opens or closes, and when the first-visit hint is dismissed.
 */
export function useOrreryStage() {
  const [stage, setStage] = useState(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = measure();
      setStage((previous) => {
        if (
          previous &&
          previous.left === next.left &&
          previous.right === next.right &&
          previous.top === next.top &&
          previous.bottom === next.bottom &&
          previous.gaugeTop === next.gaugeTop
        ) {
          return previous;
        }
        return next;
      });
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    const observer = new ResizeObserver(schedule);
    const observed = new Set();
    const observe = () => {
      for (const selector of Object.values(BOXES)) {
        const element = document.querySelector(selector);
        if (element && !observed.has(element)) {
          observed.add(element);
          observer.observe(element);
        }
      }
    };
    observe();
    // Panels and the hint mount later; watch the DOM for them and re-observe.
    const mutations = new MutationObserver(() => {
      observe();
      schedule();
    });
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "data-compact", "inert"],
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("strikehike:intro-dismissed", schedule);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("strikehike:intro-dismissed", schedule);
    };
  }, []);

  return stage;
}
