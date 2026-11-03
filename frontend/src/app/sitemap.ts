import type { MetadataRoute } from "next";
import { getCaseCatalogue, getPatternsDefault, getRegimeSummary, patternsAsOf } from "@/lib/seo/data";
import { CONTENT_DATES, absoluteUrl, type SitePath } from "@/lib/seo/site";

// Regenerated at most hourly on the server. A build without CHRONO_API_URL lists the copy dates;
// the first regeneration with data adds the data dates.
export const revalidate = 3600;

// ISO dates (YYYY-MM-DD) compare as strings.
const later = (a: string, b?: string | null) => (b && b > a ? b : a);

// Five URLs. lastmod is the later of the day the page's copy last changed and the day its data
// run to, never the build time. No changefreq or priority: Google ignores both.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [regime, cases, patterns] = await Promise.all([
    getRegimeSummary().catch(() => null),
    getCaseCatalogue().catch(() => null),
    getPatternsDefault().catch(() => null),
  ]);
  const asOf: Partial<Record<SitePath, string | undefined>> = {
    "/regime": regime?.as_of?.slice(0, 10),
    "/convergence": cases?.as_of?.slice(0, 10),
    "/patterns": patternsAsOf(patterns),
  };
  return (Object.keys(CONTENT_DATES) as SitePath[]).map((path) => ({
    url: absoluteUrl(path),
    lastModified: later(CONTENT_DATES[path], asOf[path]),
  }));
}
