// The Sky activity gauge's corona, as pure numbers: no React, no DOM, no
// imports, so the same values drive GaugeAura.jsx and the unit tests.
// Every length is in CSS pixels inside the aura box, whose centre is the
// gauge ring's centre.

export type AuraTier = 0 | 1 | 2 | 3;
export type AuraMode = "full" | "phone" | "compact";

/** 85+ a faint corona, 90+ brighter and longer, 95+ the brightest with a bead. */
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

/** The aura box per mode: unchanged from the first aura, so the layout tests hold. */
export const AURA_BOX: Record<AuraMode, number> = { full: 240, phone: 240, compact: 160 };
