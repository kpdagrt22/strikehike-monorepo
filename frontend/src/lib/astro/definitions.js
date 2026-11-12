// Shared, plain-language definitions for the two sky numbers a visitor meets.
// They are copy only: no layout or calculation lives here.

export const GEOMETRY_MATCH_DEFINITION =
  "How closely the planets' positions on this date match those on a past date. It measures geometry only and says nothing about what will happen.";


// The same definition, written for the Sky ladder's always-visible note.
export const GEOMETRY_MATCH_FOOTNOTE =
  "Geometry match compares planet positions only; it predicts nothing.";

// OWNER REVIEW: the gauge shows the backend's calibrated score
// (backend/src/astro_finance/historical_parallels.py: geometry_energy_score,
// then calibrated_geometry_score). The raw score weights hard aspects among
// Mars, Saturn, Rahu and Ketu (35%), hard-aspect density (25%), clustering in
// longitude (25%) and the retrograde share (15%); the number shown is that
// score's percentile among the curated past events. Decision D-17 (owner
// approved, 12 Nov 2026) removed the fixed stress-window floors, so no date is
// pinned above its own percentile. Keep this sentence true to that code.
export const SKY_ACTIVITY_DEFINITION =
  "Sky activity ranks the day's planetary geometry (hard aspects, how tightly the planets cluster, and retrogrades) against the past events in StrikeHike's catalogue: 50 means busier than half of them, 99 busier than almost all. It describes the sky, not markets, and is not a forecast.";
