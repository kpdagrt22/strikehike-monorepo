// Decision D-12 (owner approved, 12 Nov 2026): Politics is hidden from the
// upcoming listings and chips, the home Upcoming panel, the sitemap, the
// calendar feeds and the follow choices until it has a verified source. It
// stays in the backend model and in the analytics enums, so older Politics
// events still validate, and the theme can return later.
//
// This is the one flag those places share. The value is a theme slug, the id
// the routes and localStorage use.
export const HIDDEN_THEMES = ["politics"] as const;

// Natural Disasters is a separate, permanent rule of the backend: its dates
// cannot be scheduled (events/models.py THEME_METADATA), so it has no page,
// listing or feed either. It is not part of the owner's flag, and is folded in
// only where the question is "does this theme have a page at all".
const UNSCHEDULABLE_THEMES: readonly string[] = ["natural-disasters"];

const NO_PAGE_THEMES: ReadonlySet<string> = new Set([
  ...HIDDEN_THEMES,
  ...UNSCHEDULABLE_THEMES,
]);

/** Normalise a display name ("Culture/Religion") or slug ("culture-religion"). */
export function themeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** True only for the themes in the D-12 flag (Politics), by name or slug. */
export function isHiddenTheme(value: string): boolean {
  return (HIDDEN_THEMES as readonly string[]).includes(themeKey(value));
}

/** True for a theme with no page, listing or feed: the D-12 flag plus the
 *  permanently unschedulable Natural Disasters. */
export function hasNoThemePage(value: string): boolean {
  return NO_PAGE_THEMES.has(themeKey(value));
}
