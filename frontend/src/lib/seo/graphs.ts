// Page-level JSON-LD (plan 3.6). The root layout already declares the Person, Organization,
// WebSite, WebApplication and SoftwareSourceCode nodes; these graphs point to them by @id and
// never repeat them. Rules: no `license` on pages whose text is all rights reserved; the ledger
// Dataset is the one CC BY 4.0 exception. No `distribution` unless there is a real download (the
// ledger JSONL is the exception), no counts in static strings, and every fact here is also visible
// on its page.
import type { LedgerEntry } from "@/lib/ledger/store";
import type { Roundup } from "@/lib/roundup/store";
import { weekLabel } from "@/lib/roundup/week";
import { ABOUT_FAQ, ABOUT_TERMS } from "./faq";
import { lastModified } from "./lastmod";
import {
  patternsAsOf,
  type CaseCatalogue,
  type PatternsPayload,
  type RegimeSummary,
  type UpcomingPayload,
} from "./data";
import {
  APP_ID,
  CONTENT_DATES,
  ORG_ID,
  PAGES,
  PERSON_ID,
  SITE_URL,
  WEBSITE_ID,
  absoluteUrl,
  fullTitle,
  urlFor,
  type SitePath,
} from "./site";

type JsonLdNode = Record<string, unknown>;
export interface JsonLdGraph {
  "@context": "https://schema.org";
  "@graph": JsonLdNode[];
}

const graph = (...nodes: JsonLdNode[]): JsonLdGraph => ({
  "@context": "https://schema.org",
  "@graph": nodes,
});
const ref = (id: string) => ({ "@id": id });
const day = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
/** The later of the page's copy date and its data date (both YYYY-MM-DD). */
const later = (copy: string, data?: string) => (data && data > copy ? data : copy);

const webPageId = (path: SitePath) =>
  path === "/" ? `${SITE_URL}/#webpage` : `${absoluteUrl(path)}#webpage`;
const breadcrumbId = (path: SitePath) => `${absoluteUrl(path)}#breadcrumb`;
const datasetId = (path: SitePath) => `${absoluteUrl(path)}#dataset`;

function webPage(path: SitePath, dataDate?: string, extra: JsonLdNode = {}): JsonLdNode {
  return {
    "@type": "WebPage",
    "@id": webPageId(path),
    url: absoluteUrl(path),
    name: fullTitle(path),
    description: PAGES[path].description,
    inLanguage: "en",
    isPartOf: ref(WEBSITE_ID),
    publisher: ref(ORG_ID),
    author: ref(PERSON_ID),
    dateModified: later(CONTENT_DATES[path], dataDate),
    ...(path === "/" ? {} : { breadcrumb: ref(breadcrumbId(path)) }),
    ...extra,
  };
}

function breadcrumb(path: SitePath): JsonLdNode {
  return {
    "@type": "BreadcrumbList",
    "@id": breadcrumbId(path),
    itemListElement: [
      { "@type": "ListItem", position: 1, name: PAGES["/"].crumb, item: SITE_URL },
      { "@type": "ListItem", position: 2, name: PAGES[path].crumb, item: absoluteUrl(path) },
    ],
  };
}

// The /regime chart's own sources (Blockchain.com is not among them: the chart shows the
// S&P 500, gold, bonds and the Nifty 50).
const REGIME_SOURCES = [
  "https://fred.stlouisfed.org/series/USREC",
  "https://fred.stlouisfed.org/series/M1125AUSM343NNBR",
  "https://finance.yahoo.com/quote/%5EGSPC/",
  "https://finance.yahoo.com/quote/%5ENSEI/",
  "https://www.worldbank.org/en/research/commodity-markets",
];
const CATALOGUE_SOURCES = [...REGIME_SOURCES, "https://www.blockchain.com/explorer/charts/market-price"];

/** Shared Dataset fields: who made it, who publishes it, and that it is free to read. */
const DATASET_PARTIES = {
  creator: ref(PERSON_ID),
  publisher: ref(ORG_ID),
  isAccessibleForFree: true,
};

export function homeGraph(latestRoundupDate?: string): JsonLdGraph {
  return graph(
    webPage("/", latestRoundupDate?.slice(0, 10), {
      about: ref(APP_ID),
      mainEntity: ref(APP_ID),
    }),
  );
}

export function regimeGraph(summary: RegimeSummary | null): JsonLdGraph {
  const asOf = day(summary?.as_of);
  const start = day(summary?.coverage?.start);
  const end = day(summary?.coverage?.end);
  const version = summary?.meta?.data_version;
  const dataset: JsonLdNode = {
    "@type": "Dataset",
    "@id": datasetId("/regime"),
    name: "US market and macro atlas since 1854",
    description:
      "Weekly US market and macro history from December 1854: every NBER recession window (FRED USREC); the US stock index (Cowles Commission monthly index 1871–1927, then daily S&P closes: the S&P 90 until March 1957 and the S&P 500 after); the Core Index, a weekly reading of US market trend and stress on a −50 to +50 scale; a trend warning; gold (World Bank); a 10-year Treasury total-return model; and the Nifty 50 (Yahoo Finance).",
    url: absoluteUrl("/regime"),
    ...DATASET_PARTIES,
    spatialCoverage: ["United States", "India"],
    variableMeasured: [
      "NBER recession indicator",
      "US stock index level",
      "Core Index (−50 to +50)",
      "Trend warning",
      "Gold price",
      "10-year Treasury total-return model",
      "Nifty 50 level",
    ],
    isBasedOn: REGIME_SOURCES,
    // From the data the page was rendered with; left out when the server had none.
    ...(start && end ? { temporalCoverage: `${start}/${end}` } : {}),
    ...(asOf ? { dateModified: asOf } : {}),
    ...(typeof version === "string" && version ? { version } : {}),
  };
  return graph(
    webPage("/regime", asOf, { about: ref(datasetId("/regime")) }),
    breadcrumb("/regime"),
    dataset,
  );
}

export function convergenceGraph(catalogue: CaseCatalogue | null): JsonLdGraph {
  const asOf = day(catalogue?.as_of);
  const firsts = Object.values(catalogue?.coverage?.series_first_obs ?? {})
    .map(day)
    .filter((value): value is string => Boolean(value))
    .sort();
  const version = catalogue?.data_version;
  const dataset: JsonLdNode = {
    "@type": "Dataset",
    "@id": datasetId("/convergence"),
    name: "Catalogue of market declines since 1871",
    description:
      "Market declines found by one rule per market: falls of 15% or more on US stocks since 1871, on the Nifty 50 since 2007 and on a 10-year Treasury total-return model; 25% or more on gold (monthly average); 50% or more on Bitcoin. Each case gives its peak date, its low and depth, the days from peak to low, the date it was back at its peak (or that it has not been), and the NBER recessions it overlapped.",
    url: absoluteUrl("/convergence"),
    ...DATASET_PARTIES,
    variableMeasured: [
      "Peak date",
      "Low date",
      "Depth from peak (%)",
      "Days from peak to low",
      "Date back at peak",
      "Overlapping NBER recession",
    ],
    isBasedOn: CATALOGUE_SOURCES,
    ...(asOf ? { temporalCoverage: `${firsts[0] ?? "1871-01-01"}/${asOf}`, dateModified: asOf } : {}),
    ...(typeof version === "string" && version ? { version } : {}),
  };
  return graph(
    webPage("/convergence", asOf, { about: ref(datasetId("/convergence")) }),
    breadcrumb("/convergence"),
    dataset,
  );
}

export function patternsGraph(payload: PatternsPayload | null): JsonLdGraph {
  // engine.as_of: the date the data run to (the payload's top-level as_of is the request day).
  return graph(webPage("/patterns", patternsAsOf(payload)), breadcrumb("/patterns"));
}

const thisWeekUrl = () => urlFor("/this-week");
const weekUrl = (week: string) => urlFor(`/this-week/${week}`);

export function thisWeekGraph(roundups: Roundup[]): JsonLdGraph {
  const url = thisWeekUrl();
  const latest = roundups[0];
  const latestDate = latest?.generated_at?.slice(0, 10);
  const page = {
    "@type": "CollectionPage",
    "@id": `${url}#webpage`,
    url,
    name: "This week: macro + sky",
    description:
      "The latest approved StrikeHike weekly roundup, and every approved week in the archive.",
    inLanguage: "en",
    isPartOf: ref(WEBSITE_ID),
    publisher: ref(ORG_ID),
    author: ref(PERSON_ID),
    ...(latestDate ? { dateModified: latestDate } : {}),
    breadcrumb: ref(`${url}#breadcrumb`),
    mainEntity: ref(`${url}#archive`),
  };
  return graph(
    page,
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: PAGES["/"].crumb, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "This week", item: url },
      ],
    },
    {
      "@type": "ItemList",
      "@id": `${url}#archive`,
      name: "Approved weekly roundups",
      numberOfItems: roundups.length,
      itemListElement: roundups.map((round, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: `Week of ${weekLabel(round.week)}`,
        url: weekUrl(round.week),
      })),
    },
  );
}

export function weekGraph(
  roundup: Roundup,
  ledger: LedgerEntry | null,
  image?: string,
): JsonLdGraph {
  const url = weekUrl(roundup.week);
  const label = weekLabel(roundup.week);
  const title = `Week of ${label}`;
  const published = (
    ledger?.published_at ?? roundup.generated_at
  )?.slice(0, 10);
  const description = `The approved StrikeHike roundup for the week of ${label}: the Regime reading, the dates ahead and the sky events.`;
  const articleId = `${url}#article`;
  const skyDatasetId = `${url}#sky-dataset`;
  return graph(
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: title,
      description,
      inLanguage: "en",
      isPartOf: ref(WEBSITE_ID),
      publisher: ref(ORG_ID),
      author: ref(PERSON_ID),
      ...(published ? { dateModified: published } : {}),
      breadcrumb: ref(`${url}#breadcrumb`),
      mainEntity: ref(articleId),
      about: ref(datasetId("/regime")),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: PAGES["/"].crumb, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "This week", item: thisWeekUrl() },
        { "@type": "ListItem", position: 3, name: title, item: url },
      ],
    },
    {
      "@type": "Article",
      "@id": articleId,
      headline: title,
      description,
      url,
      ...(published ? { datePublished: published, dateModified: published } : {}),
      inLanguage: "en",
      author: ref(PERSON_ID),
      publisher: ref(ORG_ID),
      ...(image ? { image } : {}),
      isPartOf: ref(WEBSITE_ID),
      mainEntityOfPage: ref(url),
      isBasedOn: [ref(datasetId("/regime")), ref(skyDatasetId)],
    },
    {
      "@type": "Dataset",
      "@id": skyDatasetId,
      name: `Sky week ${roundup.week}`,
      description:
        "Planetary positions and sky events for the week, Swiss Ephemeris 2.10.03, Lahiri sidereal.",
      url,
      creator: ref(PERSON_ID),
      publisher: ref(ORG_ID),
      isAccessibleForFree: true,
    },
  );
}

export function ledgerGraph(entries: LedgerEntry[]): JsonLdGraph {
  const url = urlFor("/ledger");
  const first = entries[0];
  const latest = entries.at(-1);
  const published = latest?.published_at?.slice(0, 10);
  const start = first?.reading?.as_of;
  const end = latest?.reading?.as_of;
  const datasetIdValue = `${url}#dataset`;
  return graph(
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: "Published ledger",
      description:
        "A public, append-only record of the weekly StrikeHike roundups: the week, the reading, the publication time and a hash chain.",
      inLanguage: "en",
      isPartOf: ref(WEBSITE_ID),
      publisher: ref(ORG_ID),
      author: ref(PERSON_ID),
      ...(published ? { dateModified: published } : {}),
      breadcrumb: ref(`${url}#breadcrumb`),
      mainEntity: ref(datasetIdValue),
      about: ref(datasetIdValue),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: PAGES["/"].crumb, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: PAGES["/ledger"].crumb, item: url },
      ],
    },
    {
      "@type": "Dataset",
      "@id": datasetIdValue,
      name: "StrikeHike roundup ledger",
      description:
        "An append-only JSONL record of approved weekly roundups. Each line carries the week, the Core Index reading, the publication time, the SHA-256 of the LF-normalised roundup bytes and the previous line's hash.",
      url,
      creator: ref(PERSON_ID),
      publisher: ref(ORG_ID),
      isAccessibleForFree: true,
      license: "https://creativecommons.org/licenses/by/4.0/",
      variableMeasured: [
        "Week",
        "Core Index reading",
        "Reading label",
        "Publication time",
        "Roundup SHA-256",
        "Previous line hash",
      ],
      ...(start && end ? { temporalCoverage: `${start}/${end}` } : {}),
      ...(published ? { dateModified: published } : {}),
      distribution: {
        "@type": "DataDownload",
        name: "StrikeHike ledger JSONL",
        description: "One JSON object per line, oldest first.",
        contentUrl: urlFor("/ledger.jsonl"),
        encodingFormat: "application/jsonl",
      },
    },
  );
}

export function upcomingGraph(
  payload: UpcomingPayload | null,
  themes: { name: string; slug: string; count: number }[],
): JsonLdGraph {
  const url = urlFor("/upcoming");
  const dateModified = lastModified(
    CONTENT_DATES["/upcoming"],
    payload?.as_of,
  );
  const listId = `${url}#themes`;
  return graph(
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: "Upcoming dates",
      description: PAGES["/upcoming"].description,
      inLanguage: "en",
      isPartOf: ref(WEBSITE_ID),
      publisher: ref(ORG_ID),
      author: ref(PERSON_ID),
      dateModified,
      breadcrumb: ref(`${url}#breadcrumb`),
      mainEntity: ref(listId),
      about: ref(listId),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: PAGES["/"].crumb, item: SITE_URL },
        { "@type": "ListItem", position: 2, name: PAGES["/upcoming"].crumb, item: url },
      ],
    },
    {
      "@type": "ItemList",
      "@id": listId,
      name: "Upcoming themes",
      numberOfItems: themes.length,
      itemListElement: themes.map((theme, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: theme.name,
        url: urlFor(`/upcoming/${theme.slug}`),
      })),
    },
  );
}

export function disclaimerGraph(): JsonLdGraph {
  return graph(webPage("/disclaimer"), breadcrumb("/disclaimer"));
}

export function aboutGraph(): JsonLdGraph {
  const url = absoluteUrl("/about");
  const faqId = `${url}#faq`;
  const termsId = `${url}#terms`;
  return graph(
    webPage("/about", undefined, {
      mainEntity: ref(faqId),
      about: ref(termsId),
    }),
    breadcrumb("/about"),
    {
      "@type": "FAQPage",
      "@id": faqId,
      url,
      mainEntity: ABOUT_FAQ.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    },
    {
      "@type": "DefinedTermSet",
      "@id": termsId,
      name: "StrikeHike terms",
      hasDefinedTerm: ABOUT_TERMS.map((term) => ({
        "@type": "DefinedTerm",
        name: term.name,
        description: term.description,
        inDefinedTermSet: ref(termsId),
      })),
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Generated pages (/events/[id], /upcoming/[theme], /dates/[year]/[list]). Their paths are not
// in CONTENT_DATES, so they carry their own WebPage and BreadcrumbList; no schema.org Event:
// Google's Event rich result is for events people can attend, not releases or sky events.
// ---------------------------------------------------------------------------------------------

export type Crumb = { name: string; path: string };

const generatedWebPage = (
  path: string,
  name: string,
  description: string,
  dateModified: string,
  crumbs: Crumb[],
  extra: JsonLdNode = {},
) => {
  const url = urlFor(path);
  return graph(
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name,
      description,
      inLanguage: "en",
      isPartOf: ref(WEBSITE_ID),
      publisher: ref(ORG_ID),
      author: ref(PERSON_ID),
      dateModified,
      breadcrumb: ref(`${url}#breadcrumb`),
      ...extra,
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${url}#breadcrumb`,
      itemListElement: crumbs.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: crumb.name,
        item: urlFor(crumb.path),
      })),
    },
  );
};

export type EventNodeInput = {
  startDate: string;
  description?: string;
  status?: string;
};

/** An event page: Home > Upcoming dates > the event. A dated event also carries
 *  an online Event node; no offers, no attendance location. */
export function eventPageGraph(
  path: string,
  name: string,
  description: string,
  dateModified: string,
  event?: EventNodeInput,
): JsonLdGraph {
  const url = urlFor(path);
  const page = generatedWebPage(
    path,
    name,
    description,
    dateModified,
    [
      { name: PAGES["/"].crumb, path: "/" },
      { name: PAGES["/upcoming"].crumb, path: "/upcoming" },
      { name, path },
    ],
    event ? { mainEntity: ref(`${url}#event`) } : {},
  );
  if (!event) return page;
  return {
    ...page,
    "@graph": [
      ...page["@graph"],
      {
        "@type": "Event",
        "@id": `${url}#event`,
        name,
        description: event.description ?? description,
        startDate: event.startDate,
        eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
        eventStatus:
          event.status === "cancelled"
            ? "https://schema.org/EventCancelled"
            : event.status === "rescheduled"
              ? "https://schema.org/EventRescheduled"
              : "https://schema.org/EventScheduled",
        isAccessibleForFree: true,
        url,
      },
    ],
  };
}

/** A theme page: Home > Upcoming dates > the theme. */
export function themePageGraph(
  path: string,
  name: string,
  description: string,
  dateModified: string,
): JsonLdGraph {
  return generatedWebPage(path, name, description, dateModified, [
    { name: PAGES["/"].crumb, path: "/" },
    { name: PAGES["/upcoming"].crumb, path: "/upcoming" },
    { name, path },
  ]);
}

/** A year page: Home > Upcoming dates > the list. */
export function yearPageGraph(
  path: string,
  name: string,
  description: string,
  dateModified: string,
): JsonLdGraph {
  return generatedWebPage(path, name, description, dateModified, [
    { name: PAGES["/"].crumb, path: "/" },
    { name: PAGES["/upcoming"].crumb, path: "/upcoming" },
    { name, path },
  ]);
}

// ---------------------------------------------------------------------------------------------
// Reference pages (/recessions, /declines and their details). Each row's facts
// are on the page; the graph names the dataset and the one window.
// ---------------------------------------------------------------------------------------------

const referenceWebPage = (
  path: string,
  name: string,
  description: string,
  dateModified: string,
) => {
  const url = urlFor(path);
  return {
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: "en",
    isPartOf: ref(WEBSITE_ID),
    publisher: ref(ORG_ID),
    author: ref(PERSON_ID),
    dateModified,
    breadcrumb: ref(`${url}#breadcrumb`),
  };
};

const referenceBreadcrumb = (path: string, crumbs: Crumb[]) => {
  const url = urlFor(path);
  return {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: urlFor(crumb.path),
    })),
  };
};

export function referenceIndexGraph({
  path,
  name,
  description,
  dateModified,
  start,
  end,
  variableMeasured,
  sources,
  crumbs,
}: {
  path: string;
  name: string;
  description: string;
  dateModified: string;
  start?: string;
  end?: string;
  variableMeasured: string[];
  sources: string[];
  crumbs: Crumb[];
}): JsonLdGraph {
  const url = urlFor(path);
  const id = `${url}#dataset`;
  return graph(
    {
      ...referenceWebPage(path, name, description, dateModified),
      about: ref(id),
    },
    referenceBreadcrumb(path, crumbs),
    {
      "@type": "Dataset",
      "@id": id,
      name,
      description,
      url,
      ...DATASET_PARTIES,
      variableMeasured,
      isBasedOn: sources,
      ...(start && end ? { temporalCoverage: `${start}/${end}` } : {}),
      dateModified,
    },
  );
}

export function referenceDetailGraph({
  path,
  name,
  description,
  dateModified,
  datePublished,
  image,
  start,
  end,
  crumbs,
}: {
  path: string;
  name: string;
  description: string;
  dateModified: string;
  datePublished?: string;
  image?: string;
  start?: string;
  end?: string;
  crumbs: Crumb[];
}): JsonLdGraph {
  const url = urlFor(path);
  const articleId = `${url}#article`;
  return graph(
    {
      ...referenceWebPage(path, name, description, dateModified),
      about: ref(articleId),
      mainEntity: ref(articleId),
    },
    referenceBreadcrumb(path, crumbs),
    {
      "@type": "Article",
      "@id": articleId,
      headline: name,
      description,
      url,
      dateModified,
      ...(datePublished ? { datePublished } : {}),
      ...(image ? { image } : {}),
      inLanguage: "en",
      author: ref(PERSON_ID),
      publisher: ref(ORG_ID),
      isPartOf: ref(WEBSITE_ID),
      mainEntityOfPage: ref(url),
      ...(start && end
        ? {
            about: {
              "@type": "Thing",
              name: `${name} (${start} to ${end})`,
            },
          }
        : {}),
    },
  );
}
