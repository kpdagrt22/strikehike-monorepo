import type {
  UpcomingPayload,
  UpcomingThemePayload,
} from "@/lib/seo/data";

export type ThemeSlug =
  | "politics"
  | "science"
  | "finance"
  | "culture-religion"
  | "natural-disasters";

export const HIDDEN_THEMES = new Set(["Politics", "Natural Disasters"]);

const SLUG_BY_THEME: Record<string, ThemeSlug> = {
  Politics: "politics",
  Science: "science",
  Finance: "finance",
  "Culture/Religion": "culture-religion",
  "Natural Disasters": "natural-disasters",
};

const THEME_BY_SLUG: Record<ThemeSlug, string> = {
  politics: "Politics",
  science: "Science",
  finance: "Finance",
  "culture-religion": "Culture/Religion",
  "natural-disasters": "Natural Disasters",
};

const VISIBLE_ORDER = ["Science", "Finance", "Culture/Religion"];

export function themeSlug(name: string): ThemeSlug {
  return SLUG_BY_THEME[name] ?? "politics";
}

export function themeName(slug: string): string | null {
  return THEME_BY_SLUG[slug as ThemeSlug] ?? null;
}

export function isHiddenTheme(name: string) {
  return HIDDEN_THEMES.has(name);
}

export type OrderedTheme = {
  name: string;
  slug: ThemeSlug;
  data: UpcomingThemePayload;
  /** Number of events in this response, which is what the page lists. */
  count: number;
  /** Total available in the horizon, which may exceed the response list. */
  available: number;
};

/** Visible themes with at least one date, most available dates first (D-12). */
export function orderedThemes(payload: UpcomingPayload | null): OrderedTheme[] {
  if (!payload?.themes) return [];
  return Object.entries(payload.themes)
    .filter(([name]) => !isHiddenTheme(name))
    .map(([name, data]) => {
      const events = data.events ?? [];
      return {
        name,
        slug: themeSlug(name),
        data,
        count: events.length,
        available: Math.max(data.total_available ?? 0, events.length),
      };
    })
    .filter((theme) => theme.available > 0)
    .sort((left, right) => {
      if (right.available !== left.available) {
        return right.available - left.available;
      }
      return (
        VISIBLE_ORDER.indexOf(left.name) - VISIBLE_ORDER.indexOf(right.name)
      );
    });
}

export function statusLabel(status: string) {
  if (status === "tentative") return "Tentative";
  if (status === "rescheduled") return "Rescheduled";
  if (status === "cancelled") return "Cancelled";
  return null;
}
