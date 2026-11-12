// localStorage keys for retention features. Every read and write is wrapped:
// a browser that blocks storage still gets the in-memory behaviour for the
// current page, and never an exception.
import { isHiddenTheme } from "@/lib/events/hidden";

export const FOLLOW_KEY = "sh.follow.v1";
export const RECENT_KEY = "sh.recent.v1";
export const LAST_VISIT_KEY = "sh.lastvisit.v1";
export const SESSION_KEY = "sh.session.v1";

export const FOLLOW_EVENT = "strikehike:follow-changed";
export const RECENT_EVENT = "strikehike:recent-changed";

export type RecentKind = "event" | "recession" | "decline" | "date";

export type RecentItem = {
  id: string;
  kind: RecentKind;
  title: string;
  at: number;
};

export type LastVisit = {
  at: number;
  score: number | null;
  scoreAsOf: string | null;
  events: string[];
};

const EMPTY: readonly string[] = Object.freeze([]);
const EMPTY_RECENT: readonly RecentItem[] = Object.freeze([]);

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage is unavailable; the in-memory cache still clears.
  }
}

function emit(name: string) {
  try {
    window.dispatchEvent(new Event(name));
  } catch {
    // No window: nothing to notify.
  }
}

// ---- follow ----
let followCache: readonly string[] | null = null;

function cleanFollowed(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return EMPTY;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    // Decision D-12: a theme that is hidden cannot be followed, even if an
    // older build saved it in sh.follow.v1.
    if (isHiddenTheme(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.length ? out : EMPTY;
}

export function followedSnapshot(): readonly string[] {
  if (followCache !== null) return followCache;
  followCache = cleanFollowed(readJson(FOLLOW_KEY));
  return followCache;
}

export function setFollowed(next: readonly string[]) {
  followCache = cleanFollowed(next);
  writeJson(FOLLOW_KEY, followCache);
  try {
    document.documentElement.toggleAttribute(
      "data-follows",
      followCache.length > 0,
    );
  } catch {
    // No document: the next page load sets it from storage.
  }
  emit(FOLLOW_EVENT);
}

export function clearFollowed() {
  followCache = EMPTY;
  remove(FOLLOW_KEY);
  try {
    document.documentElement.removeAttribute("data-follows");
  } catch {
    // No document.
  }
  emit(FOLLOW_EVENT);
}

export function subscribeFollow(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key && event.key !== FOLLOW_KEY) return;
    followCache = null;
    listener();
  };
  window.addEventListener(FOLLOW_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(FOLLOW_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

// ---- recently viewed ----
const RECENT_MAX = 8;
const KINDS = new Set<RecentKind>(["event", "recession", "decline", "date"]);
let recentCache: readonly RecentItem[] | null = null;

function cleanRecent(value: unknown): readonly RecentItem[] {
  if (!Array.isArray(value)) return EMPTY_RECENT;
  const seen = new Set<string>();
  const out: RecentItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Partial<RecentItem>;
    if (
      typeof entry.id !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.at !== "number" ||
      !KINDS.has(entry.kind as RecentKind)
    ) {
      continue;
    }
    const key = `${entry.kind}:${entry.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: entry.id.slice(0, 160),
      kind: entry.kind as RecentKind,
      title: entry.title.slice(0, 160),
      at: entry.at,
    });
    if (out.length === RECENT_MAX) break;
  }
  return out.length ? out : EMPTY_RECENT;
}

export function recentSnapshot(): readonly RecentItem[] {
  if (recentCache !== null) return recentCache;
  recentCache = cleanRecent(readJson(RECENT_KEY));
  return recentCache;
}

export function addRecent(item: RecentItem) {
  const next = [
    item,
    ...recentSnapshot().filter(
      (entry) => !(entry.id === item.id && entry.kind === item.kind),
    ),
  ].slice(0, RECENT_MAX);
  recentCache = next;
  writeJson(RECENT_KEY, next);
  emit(RECENT_EVENT);
}

export function clearRecent() {
  recentCache = EMPTY_RECENT;
  remove(RECENT_KEY);
  emit(RECENT_EVENT);
}

export function subscribeRecent(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key && event.key !== RECENT_KEY) return;
    recentCache = null;
    listener();
  };
  window.addEventListener(RECENT_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(RECENT_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

// ---- last visit ----
export function readLastVisit(): LastVisit | null {
  const value = readJson(LAST_VISIT_KEY);
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<LastVisit>;
  if (typeof record.at !== "number" || !Number.isFinite(record.at)) return null;
  return {
    at: record.at,
    score: typeof record.score === "number" ? record.score : null,
    scoreAsOf:
      typeof record.scoreAsOf === "string" ? record.scoreAsOf : null,
    events: Array.isArray(record.events)
      ? record.events.filter((id): id is string => typeof id === "string")
      : [],
  };
}

export function writeLastVisit(record: LastVisit) {
  writeJson(LAST_VISIT_KEY, record);
}

export function sessionFlag(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setSessionFlag(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // A browser without sessionStorage simply repeats the work.
  }
}

export function recentHref(item: RecentItem): string {
  if (item.kind === "event") return `/events/${item.id.replaceAll(":", "~")}`;
  if (item.kind === "recession") return `/recessions/${item.id}`;
  if (item.kind === "decline") return `/declines/${item.id}`;
  return `/dates/${item.id}`;
}

export function recentKindLabel(kind: RecentKind): string {
  if (kind === "event") return "Date";
  if (kind === "recession") return "Recession";
  if (kind === "decline") return "Fall";
  return "List";
}
