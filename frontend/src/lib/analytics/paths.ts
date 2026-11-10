// Page templates for analytics: a real path mapped to the allow-listed template,
// never a raw id. Used by PageViewTracker (page_viewed) and FeedbackModule (the
// path stored with a message). The same three templates are in both copies of
// schema.json (frontend/src/lib/analytics and backend/src/astro_finance/analytics).

const STATIC = new Set([
  "/",
  "/regime",
  "/convergence",
  "/patterns",
  "/disclaimer",
  "/upcoming",
  "/recessions",
  "/declines",
]);
const THEMES = new Set(["science", "finance", "culture-religion"]);
const EVENT = /^\/events\/[^/]+\/?$/;
const THEME = /^\/upcoming\/([^/]+)\/?$/;
const YEAR_LIST = /^\/dates\/[^/]+\/[^/]+\/?$/;
const RECESSION = /^\/recessions\/[^/]+\/?$/;
const DECLINE = /^\/declines\/[^/]+\/?$/;

export function pageTemplate(pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (STATIC.has(path)) return path;
  if (EVENT.test(path)) return "/events/[id]";
  const theme = THEME.exec(path);
  if (theme && THEMES.has(theme[1])) return "/upcoming/[theme]";
  if (YEAR_LIST.test(path)) return "/dates/[year]/[list]";
  if (RECESSION.test(path)) return "/recessions/[id]";
  if (DECLINE.test(path)) return "/declines/[id]";
  return "404";
}
