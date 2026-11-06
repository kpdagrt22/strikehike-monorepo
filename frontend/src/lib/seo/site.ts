// Site-wide SEO constants. A plain module: safe in Server Components, metadata
// files and route handlers. No React, no browser APIs.
import type { Metadata } from "next";

export const SITE_URL = "https://strikehike.com";
export const SITE_NAME = "StrikeHike";
export const PERSON_ID = "https://thisiskp.in/#person"; // the @id thisiskp.in declares
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const APP_ID = `${SITE_URL}/#app`;
export const REPO_URL = "https://github.com/kpdagrt22/strikehike-monorepo";

// The maker, as thisiskp.in names him. Used by the root JSON-LD and the credit lines.
export const PERSON_NAME = "Prakash Kantumutchu";
export const PERSON_URL = "https://thisiskp.in";
export const PERSON_SAME_AS = [
  "https://www.linkedin.com/in/prakash-kantumutchu",
  "https://github.com/kpdagrt22",
] as const;

// Hand-maintained: the day each page's own copy last changed (YYYY-MM-DD).
// Set every page to the SEO merge date; bump one when that page's copy changes.
export const CONTENT_DATES = {
  "/": "2026-11-03",
  "/regime": "2026-11-03",
  "/convergence": "2026-11-03",
  "/patterns": "2026-11-03",
  "/disclaimer": "2026-11-03",
  "/upcoming": "2026-11-05",
} as const;
export type SitePath = keyof typeof CONTENT_DATES;

export const PAGES: Record<SitePath, { title: string; description: string; crumb: string }> = {
  "/": {
    title: "StrikeHike — The planetary sky beside market history",
    description:
      "StrikeHike sets the planetary sky beside US market history, date by date: a 3D orrery, a macro atlas since 1854 and market declines since 1871.",
    crumb: "StrikeHike",
  },
  "/regime": {
    title: "Market regime atlas: NBER recessions since 1854",
    description:
      "US market history on one chart: every NBER recession since 1854, the weekly Core Index (−50 to +50), and the S&P 500, gold, Treasuries and Nifty 50.",
    crumb: "Regime",
  },
  "/convergence": {
    title: "Compare market crashes since 1871, side by side",
    description:
      "Any two market declines since 1871, side by side: how far each fell, how long it took to recover, and the sky at each peak. Stocks, Bitcoin, gold, bonds.",
    crumb: "Convergence",
  },
  "/patterns": {
    title: "Today's market beside its closest past setups",
    description:
      "Today's S&P 500 and Nifty 50 beside their closest past setups: what followed each a year later, how often any year rose, and the 120-year mirror.",
    crumb: "Study of Patterns",
  },
  "/disclaimer": {
    title: "Disclaimer and data sources",
    description:
      "StrikeHike is descriptive historical research, not investment advice. Where its data come from: FRED, NBER, Yahoo Finance, the World Bank, Blockchain.com.",
    crumb: "Disclaimer",
  },
  "/upcoming": {
    title: "Upcoming dates",
    description:
      "Scheduled US economic releases, central-bank decisions, eclipses, solstices and religious festivals for the next 12 months, from official calendars. Subscribe in your calendar.",
    crumb: "Upcoming dates",
  },
};

export const absoluteUrl = (path: SitePath) => (path === "/" ? SITE_URL : `${SITE_URL}${path}`);

/** An absolute URL for a generated path ("/events/finance~…"), which is not a SitePath. */
export const urlFor = (path: string) => (path.startsWith("/") ? `${SITE_URL}${path}` : path);

/** The `<title>` exactly as rendered: home stands alone, the rest carry " | StrikeHike". */
export const fullTitle = (path: SitePath) =>
  path === "/" ? PAGES[path].title : `${PAGES[path].title} | ${SITE_NAME}`;

/** Title, description, canonical, Open Graph and Twitter for one page. Images come from the
 *  opengraph-image files (3.8), which take priority over this object. */
export function pageMetadata(path: SitePath): Metadata {
  const page = PAGES[path];
  const full = fullTitle(path);
  return {
    title: path === "/" ? { absolute: page.title } : page.title, // root template adds " | StrikeHike"
    description: page.description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "en_IN",
      alternateLocale: ["en_US"],
      siteName: SITE_NAME,
      url: absoluteUrl(path),
      title: full,
      description: page.description,
    },
    twitter: { card: "summary_large_image", title: full, description: page.description },
  };
}
