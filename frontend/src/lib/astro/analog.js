import baseRates from "@/data/astro/base_rates.json";

/**
 * Returns a descriptive 21-session base-rate comparison for the body's rashi.
 * This is an analog frequency, not a forecast and not a validated model output.
 */
export function analogInsight(name, rashi, retrograde) {
  const horizon = baseRates["21"];
  const feature =
    horizon.features[`${name}|rashi|${rashi}`] ??
    (retrograde ? horizon.features[`${name}|retrograde`] : null);

  if (!feature) {
    return {
      ml_insight: "No historical analog sample exists for this placement.",
      sample_size: 0,
    };
  }

  const lift = feature.minor / horizon.baseline.minor;
  const relation = lift >= 1.15 ? "above" : lift <= 0.85 ? "below" : "near";

  return {
    ml_insight: `Historical ${horizon.horizon}-session drawdown frequency is ${relation} baseline · ${lift.toFixed(2)}× over ${feature.n.toLocaleString()} sessions.`,
    sample_size: feature.n,
  };
}
