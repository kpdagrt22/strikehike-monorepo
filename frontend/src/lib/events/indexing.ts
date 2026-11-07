// The index rules for generated pages (Growth decision D-06), as pure functions. No imports:
// the same code decides robots meta, the sitemap and the unit tests.

export type IndexDecision = { index: boolean; reason: string };

export type IndexableEvent = {
  event_id: string;
  name?: string;
  status: string;
  description?: string | null;
  source_id?: string | null;
  authority_url?: string | null;
};

export type IndexableTheme = {
  /** Display name ("Culture/Religion") or slug ("culture-religion"). */
  name: string;
  /** Scheduled or tentative dates ahead, as /upcoming counts them. */
  upcoming: number;
};

// FRED's release calendar lists recurring monthly statistical releases (Employment Situation,
// CPI, GDP, Personal Income): near-identical pages, so they stay on their theme page instead.
const RECURRING_SOURCES = new Set(["fred_release_dates"]);

// A method or organisation homepage names no event. The Swiss Ephemeris page is how every sky
// event is computed, so it is never an authority for one of them.
const GENERIC_AUTHORITY_HOSTS = new Set(["www.astro.com", "astro.com"]);

const NEVER_INDEXED_THEMES = new Set(["politics", "natural-disasters"]);
const MIN_UPCOMING = 3;

function sourceOf(event: IndexableEvent): string {
  return event.source_id || event.event_id.split(":")[1] || "";
}

function authorityProblem(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return "no per-event authority page";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "the authority is not a URL";
  }
  if (url.protocol !== "https:") return "the authority is not an https URL";
  if (GENERIC_AUTHORITY_HOSTS.has(url.hostname)) {
    return "a generic method link is not a per-event authority";
  }
  if (url.pathname === "/" && !url.search) {
    return "a homepage is not a per-event authority";
  }
  return null;
}

export function isIndexableEvent(event: IndexableEvent): IndexDecision {
  if (event.status !== "scheduled") {
    return { index: false, reason: `status is ${event.status || "missing"}, not scheduled` };
  }
  if (!event.description || !event.description.trim()) {
    return { index: false, reason: "no description" };
  }
  if (RECURRING_SOURCES.has(sourceOf(event))) {
    return {
      index: false,
      reason: "a recurring statistical release (FRED); its theme page lists it",
    };
  }
  const problem = authorityProblem(event.authority_url);
  if (problem) return { index: false, reason: problem };
  const host = new URL(event.authority_url as string).hostname;
  return { index: true, reason: `scheduled, described, authority on ${host}` };
}

function themeKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isIndexableTheme(theme: IndexableTheme): IndexDecision {
  const key = themeKey(theme.name);
  if (NEVER_INDEXED_THEMES.has(key)) {
    return { index: false, reason: `${theme.name} is never indexed until it has data` };
  }
  const count = Number.isFinite(theme.upcoming) ? theme.upcoming : 0;
  if (count < MIN_UPCOMING) {
    return {
      index: false,
      reason: `${count} upcoming ${count === 1 ? "date" : "dates"}; at least ${MIN_UPCOMING} are needed`,
    };
  }
  return { index: true, reason: `${count} upcoming dates` };
}
