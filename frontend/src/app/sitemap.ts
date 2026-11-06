import type { MetadataRoute } from "next";
import { eventPath } from "@/lib/events/eventId";
import { isIndexableEvent, isIndexableTheme } from "@/lib/events/indexing";
import { themeSlug } from "@/lib/events/upcoming";
import { YEAR_LISTS, yearListPath, yearListStatus } from "@/lib/events/yearLists";
import {
  getCaseCatalogue,
  getEvent,
  getPatternsDefault,
  getRegimeSummary,
  getUpcoming,
  getUpcomingAll,
  patternsAsOf,
} from "@/lib/seo/data";
import { CONTENT_DATES, absoluteUrl, urlFor, type SitePath } from "@/lib/seo/site";

// Regenerated at most hourly on the server. A build without CHRONO_API_URL lists the copy dates;
// the first regeneration with data adds the data dates and the generated pages.
export const revalidate = 3600;

// ISO dates (YYYY-MM-DD) compare as strings.
const later = (a: string, b?: string | null) => (b && b > a ? b : a);

/** One generated URL, with the bundle date as lastmod. */
type Generated = { url: string; lastModified: string };

// Every indexable page: the hand-written ones, then the event, theme and year pages that pass
// the D-06 rules (lib/events/indexing.ts). noindex pages stay out. lastmod is the day the
// bundle was built, never the build or request time.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [regime, cases, patterns, upcoming, everything] = await Promise.all([
    getRegimeSummary().catch(() => null),
    getCaseCatalogue().catch(() => null),
    getPatternsDefault().catch(() => null),
    getUpcoming().catch(() => null),
    getUpcomingAll().catch(() => null),
  ]);
  const asOf: Partial<Record<SitePath, string | undefined>> = {
    "/regime": regime?.as_of?.slice(0, 10),
    "/convergence": cases?.as_of?.slice(0, 10),
    "/patterns": patternsAsOf(patterns),
  };
  const fixed = (Object.keys(CONTENT_DATES) as SitePath[]).map((path) => ({
    url: absoluteUrl(path),
    lastModified: later(CONTENT_DATES[path], asOf[path]),
  }));

  const bundleDate =
    upcoming?.as_of?.slice(0, 10) ?? everything?.as_of?.slice(0, 10) ?? CONTENT_DATES["/upcoming"];

  // Events: only those whose page is indexable, over the bundle's whole horizon (curated
  // central-bank dates run past 12 months).
  const events: Generated[] = [];
  for (const theme of Object.values(everything?.themes ?? {})) {
    for (const event of theme.events ?? []) {
      if (isIndexableEvent(event).index) {
        events.push({ url: urlFor(eventPath(event.event_id)), lastModified: bundleDate });
      }
    }
  }

  // Themes: at least three upcoming dates, never Politics or Natural Disasters.
  const themes: Generated[] = [];
  for (const [name, theme] of Object.entries(upcoming?.themes ?? {})) {
    const count = theme.events?.length ?? 0;
    if (isIndexableTheme({ name, upcoming: count }).index) {
      themes.push({ url: urlFor(`/upcoming/${themeSlug(name)}`), lastModified: bundleDate });
    }
  }

  // Year pages: only when every listed date is in the bundle.
  const years: Generated[] = [];
  for (const list of YEAR_LISTS) {
    const found = await Promise.all(list.entries.map((entry) => getEvent(entry.id).catch(() => null)));
    if (yearListStatus(list, found).complete) {
      years.push({ url: urlFor(yearListPath(list)), lastModified: bundleDate });
    }
  }

  return [...fixed, ...themes, ...events, ...years];
}
