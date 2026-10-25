import { create } from "zustand";

export const useEntityStore = create((set) => ({
  hoveredEntity: null,
  setHoveredEntity: (entity) => set({ hoveredEntity: entity }),
  clearHoveredEntity: () => set({ hoveredEntity: null }),
}));
