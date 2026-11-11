"use client";

// The Sky activity gauge's solar corona (owner's choice, 11 Nov 2026,
// replacing the flame crown): the ring reads like the Sun's rim in a total
// eclipse.
//   85+  a soft glowing rim and faint streamers drifting round it
//   90+  brighter, longer streamers
//   95+  the brightest corona and a "diamond ring" bead of light that
//        travels slowly round the rim
//
// Six elements at most. Two streamer layers turn in opposite directions at
// different speeds, so their rays cross and the corona seems to shimmer
// without any per-ray animation. The glow and rim only breathe. Motion is
// transform and opacity only, on the compositor; it pauses offscreen, in a
// hidden tab and under a phone sheet, and reduced motion shows one still
// frame (globals.css, .sh-corona). Purely decorative (aria-hidden): the
// number and its label carry the meaning. The score's opaque face
// (EnergyGauge) is drawn after, and so above, every layer here.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AURA_BOX, FACE_RADIUS, RING_OUTER, auraTier } from "@/lib/aura/crown";

export { auraTier };

const PHONE_QUERY = "(max-width: 639.98px)";

function subscribePhone(onChange) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getPhone = () => window.matchMedia(PHONE_QUERY).matches;
const getPhoneServer = () => false;

function subscribeVisibility(onChange) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

const getHidden = () => document.visibilityState === "hidden";
const getHiddenServer = () => false;

// Distances are measured from the centre in pixels, from the ring outward, so
// the light starts right at the ring with no gap.
function streamerMask(box) {
  const edge = box / 2;
  const reach = edge - RING_OUTER;
  return `radial-gradient(circle at 50% 50%, transparent ${FACE_RADIUS + 2}px, rgb(0 0 0 / 0.3) ${RING_OUTER + 1}px, #000 ${Math.round(RING_OUTER + reach * 0.22)}px, rgb(0 0 0 / 0.4) ${Math.round(RING_OUTER + reach * 0.6)}px, transparent ${Math.round(edge * 0.98)}px)`;
}

function glowFill(box) {
  const edge = box / 2;
  const reach = edge - RING_OUTER;
  const at = (share) => `${Math.round(RING_OUTER + reach * share)}px`;
  return `radial-gradient(circle at 50% 50%, transparent ${FACE_RADIUS + 1}px, rgb(var(--corona-core) / 0.62) ${RING_OUTER + 1}px, rgb(var(--corona-core) / 0.34) ${at(0.12)}, rgb(var(--corona-mid) / 0.16) ${at(0.35)}, rgb(var(--corona-edge) / 0.06) ${at(0.65)}, transparent ${Math.round(edge * 0.98)}px)`;
}

export function GaugeAura({
  score,
  isDark = true,
  paused = false,
  compact = false,
}) {
  const rootRef = useRef(null);
  const [offscreen, setOffscreen] = useState(false);
  const phone = useSyncExternalStore(subscribePhone, getPhone, getPhoneServer);
  const hidden = useSyncExternalStore(
    subscribeVisibility,
    getHidden,
    getHiddenServer,
  );
  const tier = auraTier(score);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setOffscreen(!entry.isIntersecting);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tier]);

  if (!tier) return null;
  const mode = compact ? "compact" : phone ? "phone" : "full";
  const box = AURA_BOX[mode];
  const stopped = paused || hidden || offscreen;
  const mask = streamerMask(box);
  const ring = RING_OUTER * 2;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="sh-aura sh-corona pointer-events-none absolute left-1/2 top-1/2"
      style={{
        width: box,
        height: box,
        marginLeft: -box / 2,
        marginTop: -box / 2,
      }}
      data-tier={tier}
      data-mode={mode}
      data-theme={isDark ? "dark" : "light"}
      data-paused={stopped ? "true" : undefined}
    >
      <div className="sh-corona-glow" style={{ background: glowFill(box) }} />
      <div
        className="sh-corona-rays"
        data-set="a"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      />
      <div
        className="sh-corona-rays"
        data-set="b"
        style={{ maskImage: mask, WebkitMaskImage: mask }}
      />
      <div
        className="sh-corona-rim"
        style={{
          width: ring,
          height: ring,
          marginLeft: -ring / 2,
          marginTop: -ring / 2,
        }}
      />
      {tier === 3 ? (
        <div className="sh-corona-orbit">
          <span
            className="sh-corona-bead"
            style={{ top: box / 2 - RING_OUTER - 4 }}
          />
        </div>
      ) : null}
    </div>
  );
}
