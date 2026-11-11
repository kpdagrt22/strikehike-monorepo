"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { soundChanged } from "@/lib/analytics/events";
import { useDismissable } from "@/hooks/useDismissable";
import {
  DEFAULT_SCAPE,
  DEFAULT_VOLUME,
  SCAPES,
  autostartChoice,
  modeOf,
  parsePrefs,
  prefsSnapshot,
  readPrefs,
  subscribePrefs,
  writePrefs,
  type SoundChoice,
} from "@/lib/sound/scapes";

type Engine = typeof import("@/lib/sound/ambient");

// useDismissable is plain JS; its inferred options type is too narrow.
const useDismissableTyped = useDismissable as (
  open: boolean,
  options: {
    onClose: () => void;
    triggerRef: RefObject<HTMLElement | null>;
    containerRef: RefObject<HTMLElement | null>;
    closeOnOutside?: boolean;
  },
) => void;

// The engine loads on first use only; the header ships just this button.
let enginePromise: Promise<Engine> | null = null;
function engine() {
  enginePromise ??= import("@/lib/sound/ambient");
  return enginePromise;
}

const BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-(--sh-line-1) bg-(--sh-surface-float) text-(--sh-text-2) shadow-(--sh-shadow-float) backdrop-blur-xl transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) focus-visible:text-(--sh-text-1)";

function SoundIcon({ on }: { on: boolean }) {
  if (on) {
    return (
      <span aria-hidden="true" className="sh-sound-bars" data-on="">
        <span />
        <span />
        <span />
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
      <path d="M16 9.5l4.5 5M20.5 9.5l-4.5 5" />
    </svg>
  );
}

// Started once per page load, however often the header remounts.
let autostarted = false;

export function SoundToggle() {
  // The saved choice, with sound on by default. The server renders the
  // default; the client reads storage after hydration. Once switched off it
  // stays off, on every page and visit, until the visitor turns it back on.
  const raw = useSyncExternalStore(subscribePrefs, prefsSnapshot, () => null);
  const prefs = parsePrefs(raw);
  const choice = modeOf(prefs);
  const volume = prefs?.volume ?? DEFAULT_VOLUME;
  const lastScape = prefs?.last ?? (choice !== "off" ? choice : DEFAULT_SCAPE);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useDismissableTyped(open, {
    onClose: () => setOpen(false),
    triggerRef,
    containerRef,
    closeOnOutside: true,
  });

  // Browsers allow no sound before a gesture: start on the first click, tap
  // or key press anywhere, this button included, unless sound is off.
  useEffect(() => {
    if (autostarted || navigator.webdriver) return;
    const listening = new AbortController();
    const begin = () => {
      listening.abort();
      autostarted = true;
      const saved = readPrefs();
      const start = autostartChoice(saved, false);
      if (!start) return;
      void engine().then((sound) => {
        sound.setVolume(saved?.volume ?? DEFAULT_VOLUME);
        if (sound.play(start)) soundChanged(start, "auto");
      });
    };
    const options = { capture: true, signal: listening.signal };
    window.addEventListener("pointerdown", begin, options);
    window.addEventListener("keydown", begin, options);
    return () => listening.abort();
  }, []);

  const choose = (next: SoundChoice) => {
    writePrefs({
      choice: next,
      volume,
      last: next !== "off" ? next : lastScape,
    });
    soundChanged(next, "click");
    void engine().then((sound) => {
      if (next === "off") sound.stop();
      else {
        sound.setVolume(volume);
        sound.play(next);
      }
    });
  };

  const changeVolume = (value: number) => {
    writePrefs({ choice, volume: value, last: lastScape });
    void engine().then((sound) => sound.setVolume(value));
  };

  const on = choice !== "off";
  const label = on
    ? `Sound on: ${SCAPES.find((scape) => scape.id === choice)?.label}. Change sound`
    : "Sound off. Change sound";

  return (
    <div ref={containerRef} className="relative" data-shell="sound">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? "site-sound-panel" : undefined}
        aria-label={label}
        data-sound={choice}
        className={BUTTON}
      >
        <SoundIcon on={on} />
      </button>

      {open ? (
        <div
          id="site-sound-panel"
          role="group"
          aria-label="Sound"
          className="absolute right-0 top-full mt-2 w-[15rem] rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-overlay) p-3 text-(--sh-text-1) shadow-(--sh-shadow-overlay)"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-micro uppercase tracking-[0.14em] text-(--sh-text-3)">
              Sound
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => choose(on ? "off" : lastScape)}
              className="rounded-full border border-(--sh-line-1) px-3 py-1 text-meta text-(--sh-text-2) hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover)"
            >
              {on ? "On" : "Off"}
            </button>
          </div>

          <div
            role="radiogroup"
            aria-label="Soundscape"
            className="mt-2 grid gap-1"
          >
            {SCAPES.map((scape) => {
              const selected = choice === scape.id;
              return (
                <button
                  key={scape.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-scape={scape.id}
                  onClick={() => choose(scape.id)}
                  className={`flex flex-col rounded-xl px-3 py-2 text-left transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) ${
                    selected ? "bg-(--sh-hover)" : ""
                  }`}
                >
                  <span className="text-body font-medium">
                    {scape.label}
                    {selected ? (
                      <span className="ml-2 text-micro text-[#c0442f] dark:text-[#ff8b77]">
                        playing
                      </span>
                    ) : null}
                  </span>
                  <span className="text-meta text-(--sh-text-3)">
                    {scape.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="mt-3 flex items-center gap-3 text-meta text-(--sh-text-3)">
            Volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(event) => changeVolume(Number(event.target.value))}
              aria-label="Sound volume"
              className="sh-sound-volume w-full"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
