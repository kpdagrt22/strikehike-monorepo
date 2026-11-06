"use client";

// The Sky activity gauge's fire, in the site's own palette (signal red, ember
// orange, gold, pearl). The geometry is lib/aura/crown.ts; the motion is the
// sh-flame / sh-ember / sh-aura rules in globals.css.
//   85+  a red crown of tongues around the top of the ring
//   90+  taller and faster, with a gold inner flame
//   95+  the tallest crown, pearl-hot tips and embers rising off it
//
// Each tongue is one masked element: its shape is an SVG mask, its colour a
// gradient from deep red at the base to gold (pearl at 95+) at the tip, and
// its edges are slightly translucent. Tongues are grouped into short sectors;
// each sector runs two loops (a scaleY lick and a skewX bend about its own
// base) with co-prime lengths and random offsets, and the sectors run out of
// phase, so the crown shimmers tongue by tongue without one animation per
// tongue. The whole crown sways, and one blurred copy of it glows behind.
// Motion is transform and opacity only, on the compositor, and continuous
// while visible (owner's choice, 4 Nov 2026): it pauses offscreen, in a
// hidden tab and under a phone sheet, and reduced motion shows one still
// frame. Purely decorative (aria-hidden): the number and its label carry the
// meaning. The score's face (EnergyGauge) is drawn above all of it, and no
// tongue's box reaches inside that face.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  FACE_RADIUS,
  RING_OUTER,
  VARIANT_COUNT,
  auraTier,
  crown,
} from "@/lib/aura/crown";

export { auraTier };

// The glow's colours (existing palette values; the tongues' own gradients are
// in globals.css). Dark glows warmer; light stays faint on the beige sky.
const GLOW = {
  dark: { fill: "#f2a54a", halo: "#f05d49", opacity: 0.6 },
  light: { fill: "#e8892f", halo: "#e8892f", opacity: 0.3 },
};

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
  const shape = crown(tier, mode);
  const glow = isDark ? GLOW.dark : GLOW.light;
  const { box } = shape;
  const centre = box / 2;
  const small = mode === "compact";
  const stopped = paused || hidden || offscreen;

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="sh-aura pointer-events-none absolute left-1/2 top-1/2"
      style={{
        width: box,
        height: box,
        marginLeft: -box / 2,
        marginTop: -box / 2,
      }}
      data-tier={tier}
      data-mode={mode}
      data-paused={stopped ? "true" : undefined}
    >
      <div
        className="sh-aura-sway"
        style={{ animationDuration: `${shape.sway}s` }}
      >
        {/* The glow: one blurred, static copy of the crown and a warm halo
            around the ring. Only its opacity breathes. Masked clear of the
            score's face. */}
        <div
          className="sh-aura-glow"
          style={{
            maskImage: `radial-gradient(circle at 50% 50%, transparent ${FACE_RADIUS + 1}px, #000 ${FACE_RADIUS + 4}px)`,
            WebkitMaskImage: `radial-gradient(circle at 50% 50%, transparent ${FACE_RADIUS + 1}px, #000 ${FACE_RADIUS + 4}px)`,
          }}
        >
          <svg
            viewBox={`0 0 ${box} ${box}`}
            width={box}
            height={box}
            className="block"
          >
            <defs>
              <filter
                id="sh-aura-blur"
                x="-25%"
                y="-25%"
                width="150%"
                height="150%"
              >
                <feGaussianBlur stdDeviation={small ? 3 : 5} />
              </filter>
            </defs>
            <g filter="url(#sh-aura-blur)" opacity={glow.opacity}>
              <circle
                cx={centre}
                cy={centre}
                r={RING_OUTER + 3}
                fill="none"
                stroke={glow.halo}
                strokeWidth={(small ? 4 : 6) + tier}
              />
              <path d={shape.glowPath} fill={glow.fill} />
            </g>
          </svg>
        </div>

        {shape.sectors.map((sector) => (
          <div
            key={sector.key}
            className="sh-sector"
            style={{
              transformOrigin: `${sector.originX}px ${sector.originY}px`,
              animationDuration: `${sector.flicker}s`,
              animationDelay: `${sector.delay}s`,
              scale: sector.still,
            }}
          >
            {sector.tongues.map((tongue) => (
              <span
                key={tongue.key}
                className="sh-flame"
                data-layer={tongue.layer}
                data-v={tongue.variant + (tongue.mirrored ? VARIANT_COUNT : 0)}
                style={{
                  left: tongue.left,
                  top: tongue.top,
                  width: tongue.width,
                  height: tongue.height,
                  rotate: `${tongue.lean}deg`,
                  opacity: tongue.opacity,
                }}
              />
            ))}
          </div>
        ))}

        {shape.embers.map((ember) => (
          <span
            key={ember.key}
            className="sh-ember"
            data-path={ember.path}
            style={{
              left: ember.left,
              top: ember.top,
              width: ember.size,
              height: ember.size,
              animationDuration: `${ember.duration}s`,
              animationDelay: `${ember.delay}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
