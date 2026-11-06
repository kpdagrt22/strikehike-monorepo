// The Sky activity gauge's flame crown, as pure geometry: no React, no DOM, no imports, so the
// same numbers drive GaugeAura.jsx and the unit tests.
//
// Every length is in CSS pixels inside the aura box, whose centre is the gauge ring's centre.
// Tongues stand on the ring's outer edge, tallest at 12 o'clock, and taper to nothing by about
// 4 and 8 o'clock. They are grouped into short angular sectors; each sector moves as one
// element (a lick and a bend about its own base) and the sectors run out of phase, so the crown
// shimmers without one element per tongue. That keeps the compositor's per-frame work low.
// Every tongue's box (not just its shape) is kept clear of the score's face.

export type AuraTier = 0 | 1 | 2 | 3;
export type CrownMode = "full" | "phone" | "compact";

export function auraTier(score: number | null | undefined): AuraTier {
  if (typeof score !== "number" || !Number.isFinite(score)) return 0;
  if (score >= 95) return 3;
  if (score >= 90) return 2;
  if (score >= 85) return 1;
  return 0;
}

/** The gauge ring: r 49 with a 2.4 px stroke (EnergyGauge.jsx). */
export const RING_OUTER = 50.2;
/** The opaque score face: r 44, inside the ring with a hairline of air. */
export const FACE_RADIUS = 44;
/** No flame or ember box comes closer to the centre than this. */
export const FACE_CLEARANCE = FACE_RADIUS + 2;

/** The aura box per mode: unchanged from the first aura, so the layout tests hold. */
export const AURA_BOX: Record<CrownMode, number> = { full: 240, phone: 240, compact: 160 };

// Four flame outlines in a unit box: base centre (0, 0), tip at y = -1, x within ±0.5.
// Each is a move and four or five cubic segments: asymmetric, with a curled or forked tip.
const VARIANTS: number[][] = [
  // curl to the right
  [-0.42, 0, -0.5, -0.2, -0.34, -0.36, -0.26, -0.52, -0.18, -0.68, -0.2, -0.84, -0.04, -1,
    0, -0.88, 0.12, -0.8, 0.18, -0.66, 0.24, -0.52, 0.36, -0.46, 0.4, -0.3, 0.46, -0.14, 0.44, -0.04, 0.36, 0],
  // forked
  [-0.38, 0, -0.5, -0.18, -0.36, -0.34, -0.3, -0.48, -0.24, -0.62, -0.32, -0.76, -0.24, -0.9,
    -0.14, -0.78, -0.06, -0.7, -0.02, -0.6, 0.02, -0.74, 0.1, -0.88, 0.2, -1,
    0.22, -0.84, 0.34, -0.68, 0.38, -0.5, 0.44, -0.3, 0.5, -0.1, 0.4, 0],
  // slim wisp
  [-0.3, 0, -0.46, -0.16, -0.18, -0.32, -0.18, -0.5, -0.18, -0.68, -0.06, -0.8, 0.06, -1,
    0.1, -0.86, 0.2, -0.74, 0.22, -0.58, 0.24, -0.4, 0.4, -0.2, 0.32, 0],
  // hooked to the left
  [-0.44, 0, -0.5, -0.24, -0.28, -0.4, -0.24, -0.58, -0.2, -0.72, -0.3, -0.86, -0.42, -0.96,
    -0.22, -0.96, -0.04, -0.86, 0.04, -0.72, 0.14, -0.56, 0.38, -0.5, 0.44, -0.3,
    0.5, -0.14, 0.48, -0.04, 0.4, 0],
];
export const VARIANT_COUNT = VARIANTS.length;

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/** An outline as SVG path data, in any coordinates the mapper chooses. */
function outline(points: number[], map: (x: number, y: number) => [number, number]) {
  const coords: string[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const [x, y] = map(points[index], points[index + 1]);
    coords.push(`${round(x)} ${round(y)}`);
  }
  const [start, ...rest] = coords;
  const segments: string[] = [];
  for (let index = 0; index < rest.length; index += 3) {
    segments.push(`C${rest[index]} ${rest[index + 1]} ${rest[index + 2]}`);
  }
  return `M${start}${segments.join("")}Z`;
}

/**
 * The mask image for one variant (mirrored or not), stretched to the flame's box. globals.css
 * carries these literally (sh-flame[data-v]); crown.test.mjs checks the two agree.
 */
export function flameMask(variant: number, mirrored: boolean): string {
  const d = outline(VARIANTS[variant], (x, y) => [mirrored ? -x : x, y]);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-0.5 -1 1 1' preserveAspectRatio='none'><path d='${d}'/></svg>`;
  return `url("data:image/svg+xml,${svg.replaceAll("<", "%3C").replaceAll(">", "%3E")}")`;
}

// A small deterministic generator: the crown is the same on the server, in the browser and in
// every screenshot, but no two tongues match.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(next: () => number, values: readonly T[]): T {
  return values[Math.floor(next() * values.length) % values.length];
}

// Loop lengths in centiseconds, from two disjoint sets of primes: a sector's two loops are
// co-prime, and no two sectors share a phase.
const LICK_CS = [79, 83, 89, 97, 101, 103, 107, 109, 113] as const;
const BEND_CS = [127, 131, 137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191] as const;

/** How far an ember rises (px): globals.css sh-ember-* (full and phone) and sh-ember-*-c. */
export const EMBER_RISE: Record<CrownMode, number> = { full: 34, phone: 34, compact: 16 };
/** Its sideways drift per path: left, right and nearly straight up. */
export const EMBER_PATHS = { l: -9, r: 9, s: 2 } as const;

type TierSpec = {
  body: number;
  core: number;
  embers: number;
  /** Sectors across the arc: more sectors, more independent motion. */
  sectors: number;
  /** Tallest flame, px, in the full box. */
  height: number;
  /** Widest flame, px, in the full box. */
  width: number;
  /** Half the arc the crown covers, in degrees from 12 o'clock. */
  spread: number;
  /** Loop-length multiplier: lower is faster. */
  pace: number;
  /** Seconds for one sway of the whole crown. */
  sway: number;
};

const TIERS: Record<1 | 2 | 3, TierSpec> = {
  1: { body: 14, core: 0, embers: 0, sectors: 6, height: 32, width: 20, spread: 108, pace: 1.14, sway: 7.8 },
  2: { body: 20, core: 8, embers: 0, sectors: 8, height: 46, width: 22, spread: 118, pace: 1, sway: 7 },
  3: { body: 24, core: 11, embers: 3, sectors: 10, height: 57, width: 24, spread: 128, pace: 0.86, sway: 6.2 },
};

const MODES: Record<CrownMode, { height: number; width: number; count: number }> = {
  full: { height: 1, width: 1, count: 1 },
  // A first-visit phone: the gauge sits under the promise, so the crown stays lower.
  phone: { height: 0.68, width: 0.85, count: 1 },
  // A returning phone visitor: the 160 px box leaves 30 px above the ring. The
  // ring is the same size, so the crown keeps its density and only lowers.
  compact: { height: 0.44, width: 0.92, count: 1 },
};

// The extremes of a sector's two loops (globals.css: sh-flame-lick on `scale`, sh-flame-bend,
// a skewX with a small translateX, on `transform`) and of the crown's sway, used to keep every
// tongue's box clear of the face.
const MOTION = {
  scaleX: 1.04,
  scaleY: 1.12,
  skew: 6,
  drift: 1.2,
  sway: 1.6,
  // A tongue sits up to half a sector away from that sector's origin: allow for the extra
  // swing the sector's skew gives it.
  sectorSwing: 2.5,
};

export type Tongue = {
  key: string;
  layer: "body" | "core";
  variant: number;
  mirrored: boolean;
  /** The box in the aura box, px. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Static lean about its base, in degrees (CSS rotate: clockwise). */
  lean: number;
  opacity: number;
};

export type Sector = {
  key: string;
  /** The point its loop turns about: the ring point at the middle of the sector. */
  originX: number;
  originY: number;
  /** Loop length and negative start offset, in seconds. */
  flicker: number;
  delay: number;
  /** The still frame's scale (reduced motion). */
  still: string;
  tongues: Tongue[];
};

export type Ember = {
  key: string;
  left: number;
  top: number;
  size: number;
  duration: number;
  delay: number;
  /** Which way it drifts while it rises (EMBER_PATHS). */
  path: keyof typeof EMBER_PATHS;
};

export type Crown = {
  tier: AuraTier;
  mode: CrownMode;
  box: number;
  sectors: Sector[];
  embers: Ember[];
  /** Every body tongue at rest as one path, for the blurred glow. */
  glowPath: string;
  sway: number;
  /** Animated elements: sectors, embers, the sway and the glow. */
  animated: number;
};

type Point = [number, number];

/** The axis-aligned box of a tongue under a given motion pose. */
function poseBox(
  base: Point,
  width: number,
  height: number,
  lean: number,
  pose: { sx: number; sy: number; skew: number; dx: number; sway: number },
  centre: number,
) {
  const lean0 = (lean * Math.PI) / 180;
  const sway = (pose.sway * Math.PI) / 180;
  const skew = Math.tan((pose.skew * Math.PI) / 180);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [cx, cy] of [
    [-width / 2, 0],
    [width / 2, 0],
    [-width / 2, -height],
    [width / 2, -height],
  ] as Point[]) {
    // The bend (translateX, then skewX), then scale, then the lean, all about the base.
    const x1 = (cx + pose.dx + cy * skew) * pose.sx;
    const y1 = cy * pose.sy;
    const x2 = x1 * Math.cos(lean0) - y1 * Math.sin(lean0) + base[0];
    const y2 = x1 * Math.sin(lean0) + y1 * Math.cos(lean0) + base[1];
    // The crown's sway turns everything about the ring's centre.
    const rx = x2 - centre;
    const ry = y2 - centre;
    const x3 = centre + rx * Math.cos(sway) - ry * Math.sin(sway);
    const y3 = centre + rx * Math.sin(sway) + ry * Math.cos(sway);
    minX = Math.min(minX, x3);
    maxX = Math.max(maxX, x3);
    minY = Math.min(minY, y3);
    maxY = Math.max(maxY, y3);
  }
  return { minX, minY, maxX, maxY };
}

/** Distance from the ring's centre to the nearest point of a box. */
export function boxDistance(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  centre: number,
) {
  const dx = Math.max(box.minX - centre, 0, centre - box.maxX);
  const dy = Math.max(box.minY - centre, 0, centre - box.maxY);
  return Math.hypot(dx, dy);
}

const POSES = (() => {
  const poses: { sx: number; sy: number; skew: number; dx: number; sway: number }[] = [];
  for (const sx of [1, MOTION.scaleX]) {
    for (const sy of [0.85, MOTION.scaleY]) {
      for (const skew of [-MOTION.skew, MOTION.skew]) {
        for (const dx of [-MOTION.drift, MOTION.drift]) {
          for (const sway of [-MOTION.sway, MOTION.sway]) {
            poses.push({ sx, sy, skew, dx, sway });
          }
        }
      }
    }
  }
  return poses;
})();

/** The nearest any pose of this tongue's box comes to the centre. */
export function flameClearance(
  base: Point,
  width: number,
  height: number,
  lean: number,
  centre: number,
) {
  let nearest = Infinity;
  for (const pose of POSES) {
    nearest = Math.min(
      nearest,
      boxDistance(poseBox(base, width, height, lean, pose, centre), centre),
    );
  }
  return nearest;
}

/** The furthest any pose of this tongue's box reaches from the box's own edges (≥ 0 = inside). */
function flameMargin(
  base: Point,
  width: number,
  height: number,
  lean: number,
  centre: number,
  box: number,
) {
  let margin = Infinity;
  for (const pose of POSES) {
    const b = poseBox(base, width, height, lean, pose, centre);
    margin = Math.min(margin, b.minX, b.minY, box - b.maxX, box - b.maxY);
  }
  return margin;
}

function place(
  angle: number,
  width: number,
  height: number,
  lean: number,
  centre: number,
): Point {
  const rad = (angle * Math.PI) / 180;
  let radius = RING_OUTER + 0.4;
  let base: Point = [centre + Math.sin(rad) * radius, centre - Math.cos(rad) * radius];
  // Step out until the whole box, in every pose, clears the face.
  while (
    flameClearance(base, width, height, lean, centre) <
    FACE_CLEARANCE + MOTION.sectorSwing
  ) {
    radius += 0.25;
    base = [centre + Math.sin(rad) * radius, centre - Math.cos(rad) * radius];
  }
  return base;
}

export function crown(tier: AuraTier, mode: CrownMode): Crown | null {
  if (tier === 0) return null;
  const spec = TIERS[tier];
  const scale = MODES[mode];
  const box = AURA_BOX[mode];
  const centre = box / 2;
  const next = random(tier * 7919 + (mode === "full" ? 1 : mode === "phone" ? 2 : 3));
  const tongues: Tongue[] = [];
  const glow: string[] = [];

  const layers: { layer: Tongue["layer"]; count: number; reach: number; tall: number; wide: number }[] = [
    { layer: "body", count: spec.body, reach: 1, tall: 1, wide: 1 },
    { layer: "core", count: spec.core, reach: 0.58, tall: 0.64, wide: 0.56 },
  ];

  // 1 at 12 o'clock, 0 at the ends of the arc: the crown's height profile.
  const profile = (angle: number) =>
    Math.cos((Math.PI / 2) * Math.min(1, Math.abs(angle) / spec.spread)) ** 1.5;

  for (const { layer, count: full, reach, tall, wide } of layers) {
    const count = Math.round(full * scale.count);
    for (let index = 0; index < count; index += 1) {
      // Even steps across -1..1 with a little jitter.
      const step = -1 + (2 * (index + 0.5)) / count + ((next() - 0.5) * 0.6) / count;
      const u = Math.max(-0.995, Math.min(0.995, step));
      const angle = Math.sign(u) * Math.abs(u) ** 1.3 * spec.spread * reach;
      const rise = profile(angle);
      // Uneven on purpose: most tongues fall short of the line, a few lick past it.
      const reachRoll = next();
      const height =
        spec.height *
        scale.height *
        tall *
        rise *
        (reachRoll < 0.22
          ? 0.5 + next() * 0.2
          : reachRoll > 0.82
            ? 1.02 + next() * 0.14
            : 0.72 + next() * 0.26);
      if (height < 3) continue; // the arc ends in nothing, not in stubs
      const width =
        spec.width * scale.width * wide * (0.22 + 0.78 * rise) * (0.78 + next() * 0.4);
      // Flames rise: near the top they stand almost upright; lower down they lean out just
      // enough to clear the ring, never as far as its radius.
      const along = Math.abs(angle) / spec.spread;
      const lean = angle * (0.24 + 0.4 * along * along + next() * 0.06) + (next() - 0.5) * 6;
      let fitted = height;
      let base = place(angle, width, fitted, lean, centre);
      // Never past the box: shorten the rare tongue that would be.
      while (fitted > 3 && flameMargin(base, width, fitted, lean, centre, box) < 1) {
        fitted -= 0.5;
        base = place(angle, width, fitted, lean, centre);
      }
      const variant = Math.floor(next() * VARIANTS.length) % VARIANTS.length;
      const mirrored = next() < 0.5;
      tongues.push({
        key: `${layer[0]}${index}`,
        layer,
        variant,
        mirrored,
        left: round(base[0] - width / 2),
        top: round(base[1] - fitted),
        width: round(width),
        height: round(fitted),
        lean: round(lean),
        // The ends of the arc fade as they shrink, so the crown thins to nothing.
        opacity: round(layer === "core" ? 0.88 : 0.42 + 0.56 * Math.sqrt(rise)),
      });
      if (layer === "body") {
        const leanRad = (lean * Math.PI) / 180;
        const cos = Math.cos(leanRad);
        const sin = Math.sin(leanRad);
        glow.push(
          outline(VARIANTS[variant], (x, y) => {
            const px = (mirrored ? -x : x) * width * 1.15;
            const py = y * fitted;
            return [base[0] + px * cos - py * sin, base[1] + px * sin + py * cos];
          }),
        );
      }
    }
  }

  // Split the tongues into contiguous sectors; each sector moves as one element, about the
  // ring point at the middle of its own span.
  const sectors: Sector[] = [];
  const count = spec.sectors;
  const buckets: Tongue[][] = Array.from({ length: count }, () => []);
  for (const tongue of tongues) {
    const x = tongue.left + tongue.width / 2 - centre;
    const y = tongue.top + tongue.height - centre;
    const angle = (Math.atan2(x, -y) * 180) / Math.PI;
    const index = Math.max(
      0,
      Math.min(count - 1, Math.floor(((angle + spec.spread) / (2 * spec.spread)) * count)),
    );
    buckets[index].push(tongue);
  }
  buckets.forEach((group, index) => {
    if (group.length === 0) return;
    const angles = group.map((tongue) => {
      const x = tongue.left + tongue.width / 2 - centre;
      const y = tongue.top + tongue.height - centre;
      return (Math.atan2(x, -y) * 180) / Math.PI;
    });
    const middle = angles.reduce((sum, angle) => sum + angle, 0) / angles.length;
    const rad = (middle * Math.PI) / 180;
    const radius = RING_OUTER + 1;
    const flicker = (pick(next, LICK_CS) / 100 + pick(next, BEND_CS) / 100) * spec.pace * 0.5;
    sectors.push({
      key: `s${index}`,
      originX: round(centre + Math.sin(rad) * radius),
      originY: round(centre - Math.cos(rad) * radius),
      flicker: round(flicker),
      delay: round(-next() * flicker),
      still: `1 ${round(0.92 + next() * 0.16)}`,
      tongues: group,
    });
  });

  const embers: Ember[] = [];
  const emberCount = Math.round(spec.embers * scale.count);
  const paths = Object.keys(EMBER_PATHS) as (keyof typeof EMBER_PATHS)[];
  for (let index = 0; index < emberCount; index += 1) {
    const size = (mode === "compact" ? 1.6 : 2.2) + next() * 1.2;
    const angle = (next() - 0.5) * 70;
    const rad = (angle * Math.PI) / 180;
    // Start inside the crown, low enough that the whole rise stays in the box.
    const highest = (centre - EMBER_RISE[mode] - size - 3) / Math.cos(rad);
    const radius = Math.min(
      highest,
      RING_OUTER + spec.height * scale.height * (0.35 + next() * 0.3),
    );
    const x = centre + Math.sin(rad) * radius;
    const y = centre - Math.cos(rad) * radius;
    // Embers on the right drift right, on the left drift left; a few rise straight.
    const path = Math.abs(angle) < 8 ? "s" : angle > 0 ? "r" : "l";
    const duration = round((1.7 + next() * 1.2) * spec.pace);
    embers.push({
      key: `e${index}`,
      left: round(x - size / 2),
      top: round(y - size / 2),
      size: round(size),
      duration,
      delay: round(-next() * duration),
      path: next() < 0.2 ? pick(next, paths) : path,
    });
  }

  return {
    tier,
    mode,
    box,
    sectors,
    embers,
    glowPath: glow.join(""),
    sway: spec.sway,
    animated: sectors.length + embers.length + 2,
  };
}
