/**
 * Ephemeris helpers for the Chrono-Spatial Engine.
 *
 * The interpolation mirrors quant_trading_app/frontend/src/services/astroAnalogs.js.
 * Source data: Swiss Ephemeris 2.10.03, Lahiri sidereal, generated for 1900–2035
 * by strikehike/scripts/generate-ephemeris.py.
 */

const DAY_MS = 86_400_000;

export const RASHIS = [
  "Mesha",
  "Vrishabha",
  "Mithuna",
  "Karka",
  "Simha",
  "Kanya",
  "Tula",
  "Vrishchika",
  "Dhanu",
  "Makara",
  "Kumbha",
  "Meena",
];

const NAKSHATRAS = [
  "Ashwini",
  "Bharani",
  "Krittika",
  "Rohini",
  "Mrigashira",
  "Ardra",
  "Punarvasu",
  "Pushya",
  "Ashlesha",
  "Magha",
  "Purva Phalguni",
  "Uttara Phalguni",
  "Hasta",
  "Chitra",
  "Swati",
  "Vishakha",
  "Anuradha",
  "Jyeshtha",
  "Mula",
  "Purva Ashadha",
  "Uttara Ashadha",
  "Shravana",
  "Dhanishta",
  "Shatabhisha",
  "Purva Bhadrapada",
  "Uttara Bhadrapada",
  "Revati",
];

export function rashiOf(lon) {
  return RASHIS[Math.floor((((lon % 360) + 360) % 360) / 30) % 12];
}

export function nakshatraOf(lon) {
  const norm = ((lon % 360) + 360) % 360;
  const index = Math.floor(norm / (360 / 27)) % 27;
  const pada = (Math.floor((norm % (360 / 27)) / (360 / 108)) % 4) + 1;
  return `${NAKSHATRAS[index]} · ${pada}`;
}

function signedDelta(a, b) {
  return ((b - a + 540) % 360) - 180;
}

function bracket(ephemeris, stepDays, ms, count) {
  const startMs = Date.parse(`${ephemeris.start}T00:00:00Z`);
  const index = (ms - startMs) / DAY_MS / stepDays;
  const last = count - 2;

  if (index <= 0) return { lo: 0, frac: 0 };
  if (index >= last) return { lo: last, frac: 0 };

  const lo = Math.floor(index);
  return { lo, frac: index - lo };
}

function lonAt(values, lo, frac) {
  const a = values[lo];
  const b = values[lo + 1];
  return (((a + signedDelta(a, b) * frac) % 360) + 360) % 360;
}

function retroAt(ephemeris, values, stepDays, ms) {
  const { lo } = bracket(ephemeris, stepDays, ms, values.length);
  const a = values[lo];
  const b = values[Math.min(lo + 1, values.length - 1)];
  return signedDelta(a, b) < 0;
}

/**
 * Today's sky from the shipped ephemeris knots.
 * Returns one record per body: { lon, rashi, nakshatra, retro }.
 */
export function currentSky(ephemeris, ms) {
  const bodies = {};

  for (const [body, values] of Object.entries(ephemeris.fast)) {
    const { lo, frac } = bracket(
      ephemeris,
      ephemeris.stepDays,
      ms,
      values.length,
    );
    const lon = lonAt(values, lo, frac);
    bodies[body] = {
      lon,
      rashi: rashiOf(lon),
      nakshatra: nakshatraOf(lon),
      retro: retroAt(ephemeris, values, ephemeris.stepDays, ms),
    };
  }

  for (const [body, values] of Object.entries(ephemeris.slow)) {
    const { lo, frac } = bracket(
      ephemeris,
      ephemeris.slowStepDays,
      ms,
      values.length,
    );
    const lon = lonAt(values, lo, frac);
    bodies[body] = {
      lon,
      rashi: rashiOf(lon),
      nakshatra: nakshatraOf(lon),
      retro: retroAt(ephemeris, values, ephemeris.slowStepDays, ms),
    };
  }

  return bodies;
}
