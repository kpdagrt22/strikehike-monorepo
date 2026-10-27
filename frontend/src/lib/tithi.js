/**
 * Panchang tithi (lunar day) from the Sun and Moon longitudes already in the
 * positions payload. Each tithi spans 12° of Moon−Sun elongation, so the
 * value is the same in the sidereal (Lahiri) and tropical zodiacs: the
 * ayanamsha cancels out.
 *
 * Tithi 15 (elongation [168°, 180°)) is Purnima; tithi 30 ([348°, 360°)) is
 * Amavasya. Descriptive only.
 */
export const TITHI_SPAN_DEG = 12;

export function tithiNumber(sunLon, moonLon) {
  const sun = Number(sunLon);
  const moon = Number(moonLon);
  if (!Number.isFinite(sun) || !Number.isFinite(moon)) return null;

  const elongation = (((moon - sun) % 360) + 360) % 360;
  return Math.floor(elongation / TITHI_SPAN_DEG) + 1;
}

export function namedTithi(positions) {
  const tithi = tithiNumber(positions?.Sun?.lon, positions?.Moon?.lon);
  if (tithi === 15) return "Purnima";
  if (tithi === 30) return "Amavasya";
  return null;
}
