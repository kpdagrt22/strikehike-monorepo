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
 * First visit, nothing saved: start the default scape quietly on the visitor's
 * first click, tap or key press (browsers allow no sound before that). Set to
 * false to make sound strictly opt-in.
 */
export const AUTOSTART_FIRST_VISIT = true;

export const SOUND_KEY = "sh.sound.v1";

export type SoundPrefs = { choice: SoundChoice; volume: number };

const CHOICES = new Set<SoundChoice>(["off", "drift", "orbit", "wind"]);

/** Null when nothing valid is saved (a first visit) or storage is blocked. */
export function parsePrefs(raw: string | null): SoundPrefs | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SoundPrefs>;
    if (!value || !CHOICES.has(value.choice as SoundChoice)) return null;
    const volume = Number(value.volume);
    return {
      choice: value.choice as SoundChoice,
      volume: Number.isFinite(volume)
        ? Math.min(1, Math.max(0, volume))
        : DEFAULT_VOLUME,
    };
  } catch {
    return null;
  }
}

export function readPrefs(): SoundPrefs | null {
  try {
    return parsePrefs(window.localStorage.getItem(SOUND_KEY));
  } catch {
    return null;
  }
}

export function writePrefs(prefs: SoundPrefs) {
  try {
    window.localStorage.setItem(SOUND_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/** What to start on the first gesture, or null to stay silent. */
export function autostartChoice(
  prefs: SoundPrefs | null,
  automated: boolean,
): Scape | null {
  if (automated) return null; // test browsers and bots stay silent
  if (prefs) return prefs.choice === "off" ? null : prefs.choice;
  return AUTOSTART_FIRST_VISIT ? DEFAULT_SCAPE : null;
}
