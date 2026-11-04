"use client";

import { useEffect, useRef } from "react";

// The Sky activity gauge's fire. From 85 the ring burns, in three tiers:
//   85+  a low orange flame on the ring's upper half
//   90+  taller flames around most of the ring, with a yellow-hot base
//   95+  a white-hot core, the full crown and sparks drifting off it
//
// A small particle fire on a 2D canvas: soft sprites rise with buoyancy,
// sway on a cheap turbulence field, swell and then shrink, and cool from
// white through yellow, orange and red to dark smoke. The inside of the ring
// is cleared every frame, so the number always reads cleanly.
//
// Motion is a bounded burst (about 3 s) when the score enters a tier or the
// parent remounts it (on hover); then the last frame is held, so nothing
// draws at rest. Under reduced motion one settled frame is computed off-screen
// and drawn once, with no animation at all. Purely decorative (aria-hidden):
// the number and its label carry the meaning.

const W = 260; // canvas size in CSS px
const H = 236;
const CX = W / 2; // the gauge ring's centre inside the canvas
const CY = 150;
const RING = 56; // just outside the ring's stroke (radius 52 in a 116 px box)
const CLEAR = 49; // the ring's interior, kept clear for the number
const BURST_S = 3.2;
const TAPER_S = 0.7; // emission eases off over the end of the burst
const STEP = 1 / 60;
// Flames burn out below this height above the ring (canvas px), so the crown
// never reaches the header above the gauge: less room on phones, where the
// gauge sits just under the header row.
const HEADROOM = 36;
const HEADROOM_COMPACT = 22;
const CEILING_FADE = 18;

const TIERS = {
  1: { rate: 85, rise: [30, 54], size: [6, 11], life: [0.45, 0.78], arc: 0.5, hot: 0.05, sparks: 0 },
  2: { rate: 150, rise: [40, 72], size: [7, 13], life: [0.5, 0.85], arc: 0.72, hot: 0.35, sparks: 5 },
  3: { rate: 240, rise: [48, 86], size: [8, 15], life: [0.55, 0.9], arc: 0.9, hot: 0.7, sparks: 16 },
};

// Heat ramps: [stop (0 = just born, 1 = dead), r, g, b, alpha].
const RAMP_DARK = [
  [0.0, 255, 250, 235, 0.95],
  [0.14, 255, 226, 140, 0.92],
  [0.34, 255, 160, 60, 0.85],
  [0.6, 232, 84, 34, 0.62],
  [0.82, 150, 40, 24, 0.3],
  [1.0, 70, 22, 18, 0],
];
const RAMP_LIGHT = [
  [0.0, 255, 214, 120, 0.9],
  [0.16, 252, 170, 60, 0.88],
  [0.38, 240, 116, 40, 0.8],
  [0.62, 206, 70, 36, 0.58],
  [0.84, 150, 52, 34, 0.14],
  [1.0, 110, 44, 32, 0],
];

export function auraTier(score) {
  if (!Number.isFinite(score)) return 0;
  if (score >= 95) return 3;
  if (score >= 90) return 2;
  if (score >= 85) return 1;
  return 0;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(min, max, random) {
  return lerp(min, max, random());
}

/** A small deterministic PRNG, so the still frame looks the same every time. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pre-rendered soft sprites, one per heat step, tinted once. */
function makeSprites(ramp) {
  const steps = 24;
  return Array.from({ length: steps }, (_, index) => {
    const t = index / (steps - 1);
    let k = 0;
    while (k < ramp.length - 2 && ramp[k + 1][0] < t) k += 1;
    const [t0, r0, g0, b0, a0] = ramp[k];
    const [t1, r1, g1, b1, a1] = ramp[k + 1];
    const u = (t - t0) / Math.max(t1 - t0, 1e-6);
    const r = Math.round(lerp(r0, r1, u));
    const g = Math.round(lerp(g0, g1, u));
    const b = Math.round(lerp(b0, b1, u));
    const alpha = lerp(a0, a1, u);
    const size = 64;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const ctx = sprite.getContext("2d");
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
    gradient.addColorStop(0.45, `rgba(${r},${g},${b},${alpha * 0.55})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return sprite;
  });
}

function spawnFlame(state, out) {
  const { tier, random } = state;
  const config = TIERS[tier];
  // Angle from the top of the ring, weighted toward the crown.
  const side = random() < 0.5 ? -1 : 1;
  const theta = side * Math.pow(random(), 1.35) * config.arc * Math.PI;
  const radius = RING + rand(-2, 3, random);
  const x = CX + Math.sin(theta) * radius;
  const y = CY - Math.cos(theta) * radius;
  const outward = rand(10, 26, random);
  const crown = (1 + Math.cos(theta)) / 2; // 1 at the top, 0 at the bottom
  out.push({
    kind: 0,
    x,
    y,
    vx: Math.sin(theta) * outward,
    vy: -Math.cos(theta) * outward * 0.6 - rand(8, 18, random),
    lift: rand(config.rise[0], config.rise[1], random) * (0.55 + 0.75 * crown) * state.liftScale,
    size: rand(config.size[0], config.size[1], random) * (0.75 + 0.45 * crown),
    life: rand(config.life[0], config.life[1], random),
    heat: random() < config.hot ? 0 : rand(0.08, 0.22, random),
    seed: random() * 1000,
    age: 0,
  });
}

function spawnSpark(random, out) {
  const theta = rand(-0.55, 0.55, random) * Math.PI;
  out.push({
    kind: 1,
    x: CX + Math.sin(theta) * (RING + 4),
    y: CY - Math.cos(theta) * (RING + 4),
    vx: rand(-14, 14, random),
    vy: -rand(40, 75, random),
    lift: rand(10, 30, random),
    size: rand(1.2, 2.2, random),
    life: rand(0.7, 1.4, random),
    heat: 0.1,
    seed: random() * 1000,
    age: 0,
  });
}

function step(state, dt, emitting) {
  const { tier, random, particles } = state;
  const config = TIERS[tier];
  state.time += dt;
  if (emitting > 0) {
    state.debt += config.rate * dt * emitting * (0.75 + 0.5 * random());
    while (state.debt >= 1) {
      spawnFlame(state, particles);
      state.debt -= 1;
    }
    if (config.sparks) {
      state.sparkDebt += (config.sparks / BURST_S) * dt * emitting;
      while (state.sparkDebt >= 1) {
        spawnSpark(random, particles);
        state.sparkDebt -= 1;
      }
    }
  }
  const t = state.time;
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.age += dt;
    if (p.age >= p.life) {
      particles.splice(i, 1);
      continue;
    }
    // Buoyancy, a sway that grows as the particle climbs, and drag.
    const sway =
      Math.sin(t * 7.3 + p.seed + p.y * 0.07) * 26 +
      Math.sin(t * 13.1 + p.seed * 1.7) * 9;
    p.vy -= p.lift * dt * (p.kind === 1 ? 0.5 : 1.6);
    p.vx += sway * dt * (0.4 + p.age / p.life);
    p.vx *= 1 - 1.8 * dt;
    p.vy *= 1 - 0.9 * dt;
    // Flames bend in toward the crown, as a fire drawn upward would.
    if (p.kind === 0) p.vx += (CX - p.x) * 0.55 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function draw(ctx, state, sprites, isDark) {
  const { particles } = state;
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = isDark ? "lighter" : "source-over";
  for (const p of particles) {
    const life = p.age / p.life;
    const heat = Math.min(1, p.heat + life * (1 - p.heat));
    const sprite = sprites[Math.min(sprites.length - 1, Math.floor(heat * sprites.length))];
    // Swell as it catches, then shrink and thin out as it rises.
    const grow = p.kind === 1 ? 1 : Math.sin(Math.min(1, life * 1.6) * Math.PI * 0.5);
    const size = p.size * (0.5 + 0.9 * grow) * (1 - 0.5 * life) * (p.kind === 1 ? 1.6 : 2.4);
    // Flames are tongues, not puffs: tall, and narrower as they climb.
    const width = p.kind === 1 ? size : size * (1 - 0.38 * life);
    const height = p.kind === 1 ? size : size * (1.45 + 0.55 * life);
    // The ceiling is measured at the flame's tip, not its centre.
    const tip = p.y - height * 0.66;
    const ceiling = Math.max(0, Math.min(1, (tip - state.ceiling) / CEILING_FADE));
    if (ceiling <= 0) continue;
    ctx.globalAlpha = (p.kind === 1 ? 1 - life : 1) * ceiling;
    ctx.drawImage(sprite, p.x - width / 2, p.y - height * 0.66, width, height);
  }
  ctx.globalAlpha = 1;
  // Keep the ring's interior clear for the number.
  ctx.globalCompositeOperation = "destination-out";
  const hole = ctx.createRadialGradient(CX, CY, CLEAR - 8, CX, CY, CLEAR + 3);
  hole.addColorStop(0, "rgba(0,0,0,1)");
  hole.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(CX, CY, CLEAR + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

export function GaugeAura({ score, isDark = true }) {
  const tier = auraTier(score);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!tier || !canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const sprites = makeSprites(isDark ? RAMP_DARK : RAMP_LIGHT);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const compact = window.matchMedia("(max-width: 639.98px)").matches;
    const state = {
      tier,
      random: mulberry32(tier * 7919 + (reduced ? 1 : Math.floor(Math.random() * 1e6))),
      particles: [],
      time: 0,
      debt: 0,
      sparkDebt: 0,
      ceiling: CY - RING - (compact ? HEADROOM_COMPACT : HEADROOM),
      liftScale: compact ? 0.72 : 1,
    };

    if (reduced) {
      // One settled frame, computed off-screen and drawn once.
      for (let t = 0; t < 1.6; t += STEP) step(state, STEP, 1);
      draw(ctx, state, sprites, isDark);
      return undefined;
    }

    let frame = 0;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const remaining = BURST_S - state.time;
      const emitting = remaining > TAPER_S ? 1 : Math.max(0.35, remaining / TAPER_S);
      step(state, dt, emitting);
      draw(ctx, state, sprites, isDark);
      if (state.time < BURST_S) {
        frame = requestAnimationFrame(tick);
      }
      // At the end of the burst the last frame stays on the canvas: a still
      // flame at rest, with no loop running.
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tier, isDark]);

  if (!tier) return null;

  return (
    <div
      aria-hidden="true"
      className="sh-aura pointer-events-none absolute left-1/2 max-sm:scale-[0.8]"
      style={{
        width: W,
        height: H,
        marginLeft: -W / 2,
        // The ring's centre (58, 58 in its 116 px box) meets the canvas's CY.
        top: 58 - CY,
        transformOrigin: `${CX}px ${CY}px`,
      }}
      data-tier={tier}
    >
      {/* A still heat glow under the flames. */}
      <span
        className="absolute rounded-full"
        style={{
          left: CX - 92,
          top: CY - 92,
          width: 184,
          height: 184,
          background: `radial-gradient(circle, transparent 0 46%, ${
            isDark ? "rgba(255, 120, 60, 0.26)" : "rgba(240, 93, 73, 0.2)"
          } 58%, transparent 72%)`,
          opacity: 0.5 + tier * 0.17,
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
