// The soundscape list and the visitor's saved choice. Kept apart from the
// audio engine so the header can render without loading it.

export type Scape = "drift" | "orbit" | "wind";
export type SoundChoice = Scape | "off";

export const SCAPES: readonly { id: Scape; label: string; hint: string }[] = [
  { id: "drift", label: "Drift", hint: "A deep space drone" },
  { id: "orbit", label: "Orbit", hint: "Slow chords and soft bells" },
  { id: "wind", label: "Solar wind", hint: "Airy noise and a faint shimmer" },
];

export const DEFAULT_SCAPE: Scape = "drift";
export const DEFAULT_VOLUME = 0.6;

/**
 * Sound is on by default (owner's choice, 11 Nov 2026): with nothing saved,
 * the mode is the default scape, and it starts quietly on the visitor's first
 * click, tap or key press (browsers allow no sound before one). Set to false
 * to make sound opt-in.
 */
export const DEFAULT_ON = true;

export const SOUND_KEY = "sh.sound.v1";

/** `last` is the scape to resume when sound is switched back on. */
export type SoundPrefs = { choice: SoundChoice; volume: number; last: Scape };

const SCAPE_IDS = new Set<SoundChoice>(["drift", "orbit", "wind"]);
const CHOICES = new Set<SoundChoice>(["off", ...SCAPE_IDS]);

/** Null when nothing valid is saved (a first visit) or storage is blocked. */
export function parsePrefs(raw: string | null): SoundPrefs | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SoundPrefs>;
    if (!value || !CHOICES.has(value.choice as SoundChoice)) return null;
    const volume = Number(value.volume);
    const choice = value.choice as SoundChoice;
    const last = SCAPE_IDS.has(value.last as SoundChoice)
      ? (value.last as Scape)
      : choice !== "off"
        ? choice
        : DEFAULT_SCAPE;
    return {
      choice,
      volume: Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : DEFAULT_VOLUME,
      last,
    };
  } catch {
    return null;
  }
}

/** The mode to show and play: the saved choice, or the default. */
export function modeOf(prefs: SoundPrefs | null): SoundChoice {
  if (prefs) return prefs.choice;
  return DEFAULT_ON ? DEFAULT_SCAPE : "off";
}

/** What to start on the first gesture, or null to stay silent. */
export function autostartChoice(
  prefs: SoundPrefs | null,
  automated: boolean,
): Scape | null {
  if (automated) return null; // test browsers and bots stay silent
  const mode = modeOf(prefs);
  return mode === "off" ? null : mode;
}

// A tiny store so every reader re-renders when the choice changes, including
// in other tabs. Falls back to memory when storage is blocked.
const listeners = new Set<() => void>();
let memory: string | null = null;

export function prefsSnapshot(): string | null {
  try {
    return window.localStorage.getItem(SOUND_KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function subscribePrefs(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SOUND_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function readPrefs(): SoundPrefs | null {
  return parsePrefs(prefsSnapshot());
}

export function writePrefs(prefs: SoundPrefs) {
  memory = JSON.stringify(prefs);
  try {
    window.localStorage.setItem(SOUND_KEY, memory);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  for (const listener of listeners) listener();
}
