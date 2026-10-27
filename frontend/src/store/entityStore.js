import { create } from "zustand";

export const useEntityStore = create((set) => ({
  hoveredEntity: null,
  setHoveredEntity: (entity) => set({ hoveredEntity: entity }),
  clearHoveredEntity: () => set({ hoveredEntity: null }),
  // A tap or click pins the readout open (touch parity with hover).
  pinnedEntity: null,
  pinEntity: (entity) => set({ pinnedEntity: entity }),
  clearPinnedEntity: () => set({ pinnedEntity: null }),
}));
