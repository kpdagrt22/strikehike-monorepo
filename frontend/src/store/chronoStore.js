import { create } from "zustand";

export const TIMELINE_MIN = "1906-07-13";
export const TIMELINE_MAX = "2027-12-31";

export function currentUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

// Start on today's UTC date. The date only changes when the user selects a
// timeline marker, event, future ladder entry, or precise datetime.
export const DEFAULT_FOCUSED_DATE = currentUtcDate();

export const useChronoStore = create((set) => ({
  focusedDate: DEFAULT_FOCUSED_DATE,
  focusedTime: "00:00",
  positions: null,
  source: null,
  status: "idle",
  energy: null,
  parallels: [],
  marketEnergy: null,
  sources: null,
  cameraView: "orbital",
  cameraRevision: 0,
  mobileSheet: null,
  timeControlsExpanded: false,
  activeEventCategory: null,

  setFocusedDate: (focusedDate) =>
    set({ focusedDate, focusedTime: "00:00" }),
  setFocusedTime: (focusedTime) => set({ focusedTime }),
  setFocusedDateTime: (focusedDate, focusedTime) =>
    set({
      focusedDate,
      focusedTime: focusedTime || "00:00",
    }),
  setCameraView: (cameraView) =>
    set((state) => ({
      cameraView,
      cameraRevision: state.cameraRevision + 1,
    })),
  setMobileSheet: (mobileSheet) => set({ mobileSheet }),
  setTimeControlsExpanded: (timeControlsExpanded) =>
    set({ timeControlsExpanded }),
  setActiveEventCategory: (activeEventCategory) =>
    set({ activeEventCategory }),

  setPositions: (payload) =>
    set((state) => {
      const responseDateTime =
        payload.datetime ?? `${payload.date}T00:00`;
      const selectedDateTime = `${state.focusedDate}T${state.focusedTime}`;
      return payload.date === state.focusedDate &&
        responseDateTime === selectedDateTime
        ? {
            positions: payload.bodies,
            source: payload.source,
            status: "ready",
            energy: payload.energy ?? null,
            parallels: payload.parallels ?? [],
            marketEnergy: payload.marketEnergy ?? null,
            sources: payload.sources ?? null,
          }
        : {};
    }),

  setStatus: (status) => set({ status }),
}));
