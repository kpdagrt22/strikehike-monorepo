"use client";

import { useRegimeOverlay } from "@/hooks/useRegimeOverlay";

// The overlay hook subscribes to the focused date. Keeping it in this leaf
// means date scrubbing no longer re-renders the whole home tree.
export function RegimeOverlaySync() {
  useRegimeOverlay();
  return null;
}
