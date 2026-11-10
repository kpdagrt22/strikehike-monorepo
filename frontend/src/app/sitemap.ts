import type { MetadataRoute } from "next";
import { eventPath } from "@/lib/events/eventId";
import { isIndexableEvent, isIndexableTheme } from "@/lib/events/indexing";
import { themeSlug } from "@/lib/events/upcoming";
import { YEAR_LISTS, yearListPath, yearListStatus } from "@/lib/events/yearLists";
import {
  getCaseCatalogue,
  getEvent,
  getPatternsDefault,
  getRegimeAtlas,
  getRegimeSummary,
  getUpcoming,
  getUpcomingAll,
  patternsAsOf,
} from "@/lib/seo/data";
import {
  declinePath,
  declineRecordComplete,
  declinesComplete,
  recessionFacts,
  recessionIndexable,
  recessionPath,
  recessionsComplete,
  trendRecord,
} from "@/lib/reference/reference";
import { CONTENT_DATES, absoluteUrl, urlFor, type SitePath } from "@/lib/seo/site";

// Generated per request: the Docker build has no backend, so a prerendered copy would list
// only the fixed pages until its revalidate window passed. The data reads are cached for 60 s.
export const dynamic = "force-dynamic";

// ISO dates (YYYY-MM-DD) compare as strings.
const later = (a: string, b?: string | null) => (b && b > a ? b : a);

/** One generated URL, with the bundle date as lastmod. */
type Generated = { url: string; lastModified: string };

// Every indexable page: the hand-written ones, then the event, theme and year pages that pass
// the D-06 rules (lib/events/indexing.ts). noindex pages stay out. lastmod is the day the
// bundle was built, never the build or request time.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [regime, cases, patterns, upcoming, everything, atlas] = await Promise.all([
    getRegimeSummary().catch(() => null),
    getCaseCatalogue().catch(() => null),
    getPatternsDefault().catch(() => null),
    getUpcoming().catch(() => null),
    getUpcomingAll().catch(() => null),
    getRegimeAtlas().catch(() => null),
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

  // Reference pages: the index only when its payload is complete, a detail
  // page only when that window/fall has its dates and S&P figure (D-06).
  const reference: Generated[] = [];
  const referenceDate = atlas?.as_of?.slice(0, 10) ?? bundleDate;
  if (recessionsComplete(atlas)) {
    reference.push({
      url: urlFor("/recessions"),
      lastModified: referenceDate,
    });
    for (const crash of atlas!.crashes) {
      const facts = recessionFacts(atlas!, crash);
      if (recessionIndexable(facts)) {
        reference.push({
          url: urlFor(recessionPath(crash.id)),
          lastModified: referenceDate,
        });
      }
    }
  }
  if (declinesComplete(atlas?.meta)) {
    reference.push({ url: urlFor("/declines"), lastModified: referenceDate });
    const record = trendRecord(atlas?.meta);
    for (const fall of record?.falls ?? []) {
      if (declineRecordComplete(fall)) {
        reference.push({
          url: urlFor(declinePath(fall.id)),
          lastModified: referenceDate,
        });
      }
    }
  }

  return [...fixed, ...themes, ...events, ...years, ...reference];
}
