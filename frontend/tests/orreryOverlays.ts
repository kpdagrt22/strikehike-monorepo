// The home HUD blocks the orrery must stay clear of; shared by the live
// orrery checks and the poster-mode spec.
export const ORRERY_OVERLAYS: Array<[string, string]> = [
  ["intro", "[data-home-intro]"],
  ["change note", "[data-home-change-note]"],
  ["gauge", '[data-hud="gauge"]'],
  ["aura", ".sh-aura"],
  ["captions", "[data-gauge-captions]"],
  ["hint", "[data-home-hint]"],
  ["left column", "[data-home-left-column]"],
  ["right panel", "#chrono-alignment-sheet"],
  ["time controls", '[data-hud="timeline"]'],
  ["dock", '[data-hud="dock"]'],
  ["feedback", "[data-home-feedback]"],
  ["sponsor", "[data-home-sponsor]"],
];
