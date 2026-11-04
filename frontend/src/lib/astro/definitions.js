// Shared, plain-language definitions for the two sky numbers a visitor meets.
// They are copy only: no layout or calculation lives here.

export const GEOMETRY_MATCH_DEFINITION =
  "How closely the planets' positions on this date match those on a past date. It measures geometry only and says nothing about what will happen.";

// OWNER REVIEW: drafted from frontend/src/lib/astro/energy.js. The local
// fallback weights hard aspects among the malefic pairs (35%), hard-aspect
// density across all measured pairs (25%), longitude concentration (25%) and
// the retrograde share of Mercury to Saturn (15%), then scales the result to
// 0-100. Keep this sentence in step with that function.
export const SKY_ACTIVITY_DEFINITION =
  "Sky activity scores the day's planetary geometry from 0 to 100: 35% hard aspects among Mars, Saturn, Rahu and Ketu, 25% the share of all measured pairs in a hard aspect, 25% how closely the eight bodies cluster in longitude, and 15% the share of Mercury to Saturn that is retrograde. It describes geometry only and is not a market forecast.";
