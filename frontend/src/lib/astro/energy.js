/**
 * Local geometry energy fallback for the Next proxy.
 *
 * The FastAPI historical endpoint is the authoritative source. This module
 * keeps the gauge alive when that service is temporarily unreachable, using
 * the same weighting scheme as astro_finance/historical_parallels.py.
 */

const MATCH_BODIES = [
  "Sun",
  "Mercury",
  "Venus",
  "Mars",
  "Jupiter",
  "Saturn",
  "Rahu",
  "Ketu",
];

const MALEFIC_PAIRS = [
  [["Mars", "Saturn"], 0.3],
  [["Mars", "Rahu"], 0.2],
  [["Mars", "Ketu"], 0.2],
  [["Saturn", "Rahu"], 0.15],
  [["Saturn", "Ketu"], 0.15],
];

const RETRO_BODIES = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const HARD_ASPECTS = [
  [0, 6],
  [90, 5],
  [180, 6],
];

const DESCRIPTIONS = {
  Favorable:
    "Low kinetic energy, constructive historical conditions, and a supportive volatility regime.",
  Disruptive:
    "High kinetic energy, historical correlation with sudden market shifts.",
  Neutral:
    "Moderate kinetic energy, mixed historical signals, and a consolidating volatility regime.",
};

const STATES = {
  Favorable: "Favorable/Positive",
  Disruptive: "Disruptive/Negative",
  Neutral: "Neutral/Consolidating",
};

function angularDistance(a, b) {
  return Math.abs(((a - b + 180) % 360) - 180);
}

function isHardAspect(a, b) {
  const separation = angularDistance(a, b);
  return HARD_ASPECTS.some(([target, orb]) => Math.abs(separation - target) <= orb);
}

function polarityForScore(score) {
  if (score >= 28) return "Disruptive";
  if (score <= 18) return "Favorable";
  return "Neutral";
}

export function localGeometryEnergy(bodies) {
  const available = MATCH_BODIES.filter((body) => bodies?.[body]?.lon != null);
  if (!available.length) return null;

  const maleficPairs = MALEFIC_PAIRS.filter(
    ([pair]) => available.includes(pair[0]) && available.includes(pair[1]),
  );
  const totalWeight = maleficPairs.reduce((sum, [, weight]) => sum + weight, 0);
  const activeWeight = maleficPairs.reduce(
    (sum, [pair, weight]) =>
      isHardAspect(bodies[pair[0]].lon, bodies[pair[1]].lon)
        ? sum + weight
        : sum,
    0,
  );
  const malefic = totalWeight ? activeWeight / totalWeight : 0;

  let hardAspects = 0;
  let pairCount = 0;
  for (let i = 0; i < available.length; i += 1) {
    for (let j = i + 1; j < available.length; j += 1) {
      pairCount += 1;
      if (isHardAspect(bodies[available[i]].lon, bodies[available[j]].lon)) {
        hardAspects += 1;
      }
    }
  }
  const aspectDensity = pairCount ? hardAspects / pairCount : 0;

  const sinSum = available.reduce(
    (sum, body) => sum + Math.sin((bodies[body].lon * Math.PI) / 180),
    0,
  );
  const cosSum = available.reduce(
    (sum, body) => sum + Math.cos((bodies[body].lon * Math.PI) / 180),
    0,
  );
  const concentration = Math.hypot(sinSum, cosSum) / available.length;

  const retroBodies = RETRO_BODIES.filter((body) => available.includes(body));
  const retroShare = retroBodies.length
    ? retroBodies.filter((body) => bodies[body].retro).length /
      retroBodies.length
    : 0;

  const raw =
    0.35 * malefic +
    0.25 * aspectDensity +
    0.25 * concentration +
    0.15 * retroShare;
  const score = Math.round(Math.max(0, Math.min(1, raw)) * 100);
  const polarity = polarityForScore(score);

  return {
    score,
    polarity,
    state: STATES[polarity],
    description: DESCRIPTIONS[polarity],
    source: "local_geometry",
  };
}
