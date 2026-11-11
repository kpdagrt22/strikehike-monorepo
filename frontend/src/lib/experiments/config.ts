// Typed experiment configuration. One place declares every experiment, its
// variants, their weights, whether it is live, and the surfaces (page keys) it
// may run on. Nothing here reads storage or the DOM: config.ts is importable
// from a test, a server component and the client bundle alike.
//
// Weights are relative and need not sum to one. The control variant is always
// variants[0]; an inactive experiment serves it.

export type ExperimentId = "home-cta";

export type Experiment = {
  id: ExperimentId;
  /** Variant ids, control first. */
  variants: readonly string[];
  /** Relative weights, parallel to `variants`. */
  weights: readonly number[];
  /** An inactive experiment always serves the control variant. */
  active: boolean;
  /** The surfaces (page keys) where the experiment may run. */
  surfaces: readonly string[];
};

export const EXPERIMENTS: readonly Experiment[] = [
  {
    // The home call to action: the current label against a shorter, plainer one.
    // Defined, and deliberately not live, so nothing changes for anyone yet.
    id: "home-cta",
    variants: ["control", "record"],
    weights: [0.5, 0.5],
    active: false,
    surfaces: ["home"],
  },
];

const BY_ID = new Map(EXPERIMENTS.map((experiment) => [experiment.id, experiment]));

export function experimentById(id: string): Experiment | null {
  return BY_ID.get(id as ExperimentId) ?? null;
}

/** The plain control assignment: no storage, no hash, no event. */
export function controlVariant(experiment: Experiment): string {
  return experiment.variants[0];
}
