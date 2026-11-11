// The pure half of the experiment assignment: the hash, the `?exp` override and
// everything that decides which variant a visitor sees. No browser and no
// runtime imports, so useExperiment.ts can call it and a unit test can too.

import type { Experiment, ExperimentId } from "./config";

export const EXPERIMENT_TOKEN = /^[a-z0-9-]{1,32}$/;
export const ANONYMOUS_ID = /^[\w-]{22}$/;
export const OVERRIDE_PARAM = "exp";

export type Assignment = {
  /** The variant actually shown. */
  variant: string;
  /** True when that variant is the experiment's control. */
  isControl: boolean;
  /** True when this screen should report an exposure event. */
  track: boolean;
};

export type Override = { id: string; variant: string };

// FNV-1a 32-bit followed by the murmur3 finalizer. The finalizer matters: raw
// FNV-1a keeps neighbouring inputs correlated in the low bits, and the variant
// is chosen from the whole 32-bit value, so the avalanche mix keeps the split
// even across a realistic range of ids.
export function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** The variant index for a hash, according to the relative weights. */
export function pickVariant(hash: number, weights: readonly number[]): number {
  if (weights.length === 0) return 0;
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return 0;
  let point = (hash / 0x1_0000_0000) * total;
  for (let index = 0; index < weights.length; index += 1) {
    point -= Math.max(0, weights[index]);
    if (point < 0) return index;
  }
  return weights.length - 1;
}

/** The variant index for an anonymous id in one experiment. */
export function variantIndex(
  experimentId: string,
  anonymousId: string,
  weights: readonly number[],
): number {
  return pickVariant(stableHash(`${anonymousId}|${experimentId}`), weights);
}

/** Parse a raw `?exp=<id>:<variant>` value, or null when it does not fit. */
export function parseOverride(raw: string | null | undefined): Override | null {
  if (!raw) return null;
  const at = raw.indexOf(":");
  if (at <= 0) return null;
  const id = raw.slice(0, at);
  const variant = raw.slice(at + 1);
  if (!EXPERIMENT_TOKEN.test(id) || !EXPERIMENT_TOKEN.test(variant)) return null;
  return { id, variant };
}

/**
 * Which variant to show, and whether to report it.
 *
 * * A matching `?exp` override wins: that variant is shown and reported.
 * * An inactive experiment serves control and reports nothing.
 * * An active experiment with no anonymous id serves control and reports
 *   nothing (there is no stable key to split on).
 * * Otherwise the variant comes from the id-and-experiment hash, and both the
 *   control and treatment groups are reported.
 */
export function resolveExperiment(
  experiment: Experiment,
  anonymousId: string | null,
  override: Override | null,
): Assignment {
  const control = experiment.variants[0];
  if (
    override &&
    override.id === experiment.id &&
    experiment.variants.includes(override.variant)
  ) {
    return {
      variant: override.variant,
      isControl: override.variant === control,
      track: true,
    };
  }
  if (!experiment.active || !anonymousId) {
    return { variant: control, isControl: true, track: false };
  }
  const index = variantIndex(experiment.id, anonymousId, experiment.weights);
  const variant = experiment.variants[index] ?? control;
  return { variant, isControl: variant === control, track: true };
}

/** resolveExperiment for an experiment looked up by id. */
export function resolveIn(
  experiments: readonly Experiment[],
  id: ExperimentId,
  anonymousId: string | null,
  override: Override | null,
): Assignment {
  const experiment = experiments.find((item) => item.id === id);
  if (!experiment) {
    return { variant: "control", isControl: true, track: false };
  }
  return resolveExperiment(experiment, anonymousId, override);
}
