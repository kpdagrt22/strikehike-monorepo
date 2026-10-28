import { create } from "zustand";

export const TIMELINE_MIN = "1906-07-13";
export const TIMELINE_MAX = "2027-12-31";

export function currentUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

// Start on today's UTC date. The date only changes when the user selects a
// timeline marker, event, future ladder entry, or precise datetime.
export const DEFAULT_FOCUSED_DATE = currentUtcDate();

// One shared empty list: a scrub step that clears the parallels keeps the same
// reference, so subscribers that only read `parallels` do not re-render.
const NO_PARALLELS = [];

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
  ladderMatches: [],
  ladderStatus: "idle",
  regimeOverlay: false,
  regimeTone: null,
  regimeOverlayStatus: "idle",
  // Moment the current `positions` describe ("YYYY-MM-DDTHH:MM"), so a failed
  // date change is never shown as the new sky. Bumping the retry key re-runs
  // the positions request for the focused moment.
  positionsDateTime: null,
  positionsRetryKey: 0,

  // Re-selecting the focused moment is a no-op: returning the same state
  // notifies nobody, so nothing waits on a request that never runs.
  setFocusedDate: (focusedDate) =>
    set((s) =>
      s.focusedDate === focusedDate && s.focusedTime === "00:00"
        ? s
        : {
            focusedDate,
            focusedTime: "00:00",
            parallels: NO_PARALLELS,
            status: "loading",
          },
    ),
  setFocusedTime: (focusedTime) =>
    set((s) =>
      s.focusedTime === focusedTime
        ? s
        : { focusedTime, parallels: NO_PARALLELS, status: "loading" },
    ),
  setFocusedDateTime: (focusedDate, focusedTime) =>
    set((s) => {
      const time = focusedTime || "00:00";
      return s.focusedDate === focusedDate && s.focusedTime === time
        ? s
        : {
            focusedDate,
            focusedTime: time,
            parallels: NO_PARALLELS,
            status: "loading",
          };
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
  setLadder: ({ matches, status }) =>
    set({ ladderMatches: matches, ladderStatus: status }),
  setRegimeOverlay: (regimeOverlay) => set({ regimeOverlay }),
  setRegimeTone: (regimeTone) => set({ regimeTone }),
  setRegimeOverlayStatus: (regimeOverlayStatus) =>
    set({ regimeOverlayStatus }),

  setPositions: (payload) =>
    set((state) => {
      const responseDateTime =
        payload.datetime ?? `${payload.date}T00:00`;
      const selectedDateTime = `${state.focusedDate}T${state.focusedTime}`;
      return payload.date === state.focusedDate &&
        responseDateTime === selectedDateTime
        ? {
            positions: payload.bodies,
            positionsDateTime: responseDateTime,
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
  retryPositions: () =>
    set((state) => ({
      positionsRetryKey: state.positionsRetryKey + 1,
      status: "loading",
    })),
}));
