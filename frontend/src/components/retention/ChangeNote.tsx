"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { changeNote } from "@/lib/analytics/events";
import { isHiddenTheme, themeName } from "@/lib/events/upcoming";
import {
  followedSnapshot,
  readLastVisit,
  sessionFlag,
  setSessionFlag,
  writeLastVisit,
  type LastVisit,
} from "@/lib/retention/storage";

const DAY = 86_400_000;
const SESSION_NOTED = "sh.lastvisit.noted";

type Current = {
  score: number | null;
  asOf: string | null;
  events: string[];
  week: string | null;
};

async function getJson(path: string): Promise<unknown> {
  try {
    const response = await fetch(path);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function loadCurrent(): Promise<Current> {
  const [regime, upcoming, roundup] = await Promise.all([
    getJson("/api/v1/regime/macro-history?resolution=monthly&start=2025-01-01"),
    getJson("/api/v1/events/upcoming?limit_per_theme=100&horizon_days=365"),
    getJson("/this-week/latest.json"),
  ]);
  const latest = (regime as { meta?: { latest_core_index?: { score?: unknown; date?: unknown } } })
    ?.meta?.latest_core_index;
  const score = Number.isFinite(Number(latest?.score))
    ? Number(latest?.score)
    : null;
  const asOf = typeof latest?.date === "string" ? latest.date : null;
  const themes =
    (upcoming as { themes?: Record<string, { events?: Array<{ event_id?: unknown }> }> })
      ?.themes ?? {};
  const events: string[] = [];
  for (const [name, theme] of Object.entries(themes)) {
    if (isHiddenTheme(name)) continue;
    for (const event of theme.events ?? []) {
      if (typeof event.event_id === "string") events.push(event.event_id);
    }
  }
  const week =
    (roundup as { week?: unknown })?.week;
  return {
    score,
    asOf,
    events,
    week: typeof week === "string" ? week : null,
  };
}

const signed = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

type Note = {
  days: number;
  scoreThen: number | null;
  scoreNow: number | null;
  newDates: number;
  followed: boolean;
  week: string | null;
};

function buildNote(
  record: LastVisit,
  current: Current,
  followed: readonly string[],
  now: number,
): Note {
  const names = followed
    .map((id) => themeName(id))
    .filter((name): name is string => Boolean(name));
  const relevant = new Set<string>();
  if (names.length > 0) {
    for (const name of names) relevant.add(name);
  }
  const known = new Set(record.events);
  const newDates = current.events.filter((id) => {
    if (known.has(id)) return false;
    if (names.length === 0) return true;
    // Event ids start with the theme slug ("finance:…").
    return [...relevant].some((name) =>
      id.startsWith(`${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:`),
    );
  }).length;
  const scoreChanged =
    record.score != null &&
    current.score != null &&
    record.score !== current.score;
  return {
    days: Math.max(1, Math.floor((now - record.at) / DAY)),
    scoreThen: scoreChanged ? record.score : null,
    scoreNow: scoreChanged ? current.score : null,
    newDates,
    followed: names.length > 0,
    week: current.week,
  };
}

export function ChangeNote({ where }: { where: "home" | "upcoming" }) {
  const [note, setNote] = useState<Note | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (sessionFlag(SESSION_NOTED)) return;
    let cancelled = false;
    let timer = 0;

    const run = async () => {
      const record = readLastVisit();
      const now = Date.now();
      const returning = Boolean(record && now - record.at >= DAY);
      const current = await loadCurrent();
      if (cancelled) return;

      if (returning && record) {
        const next = buildNote(record, current, followedSnapshot(), now);
        setNote(next);
        setVisible(true);
        changeNote("shown");
      }

      if (current.score != null || current.events.length > 0) {
        writeLastVisit({
          at: now,
          score: current.score,
          scoreAsOf: current.asOf,
          events: current.events,
        });
      }
      setSessionFlag(SESSION_NOTED, "1");
    };

    // Off the first paint: the note is not part of LCP, and the small snapshot
    // fetch must not compete with the orrery or the Upcoming list.
    timer = window.setTimeout(run, 2_500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (!visible || !note) return null;

  const scoreLine =
    note.scoreThen != null && note.scoreNow != null
      ? `The Regime score moved from ${signed(note.scoreThen)} to ${signed(note.scoreNow)}.`
      : null;
  const datesLine =
    note.newDates === 0
      ? note.followed
        ? "No new dates were added in your themes."
        : "No new dates were added across all themes."
      : `${note.newDates} new ${note.newDates === 1 ? "date was" : "dates were"} added ${
          note.followed ? "in your themes" : "across all themes"
        }.`;

  return (
    <aside
      data-change-note={where}
      data-home-change-note={where === "home" ? "" : undefined}
      className={`pointer-events-auto rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-3 text-left shadow-(--sh-shadow-float) ${
        where === "home"
          ? "mt-3 w-full lg:fixed lg:left-1/2 lg:top-[22rem] lg:z-30 lg:mt-0 lg:w-[24rem] lg:-translate-x-1/2"
          : "mt-4"
      }`}
    >
      <p className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
        Since your last visit
      </p>
      <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
        {note.days === 1 ? "One day" : `${note.days} days`} ago.{" "}
        {scoreLine ? `${scoreLine} ` : ""}
        {datesLine}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {note.week ? (
          <Link
            href="/this-week"
            data-change-note-link=""
            onClick={() => changeNote("clicked")}
            className="inline-flex min-h-9 items-center text-micro font-medium text-(--sh-text-1) underline decoration-current/30 underline-offset-2 hover:decoration-current focus-visible:decoration-current pointer-coarse:min-h-11"
          >
            Read this week&apos;s roundup
          </Link>
        ) : null}
        <button
          type="button"
          data-dismiss-change-note=""
          onClick={() => {
            setVisible(false);
            changeNote("dismissed");
          }}
          className="inline-flex min-h-9 items-center rounded-full px-2 text-micro font-medium text-(--sh-text-2) underline decoration-current/30 underline-offset-2 transition-colors hover:text-(--sh-text-1) hover:decoration-current focus-visible:text-(--sh-text-1) focus-visible:decoration-current pointer-coarse:min-h-11"
        >
          Dismiss
        </button>
      </div>
    </aside>
  );
}
