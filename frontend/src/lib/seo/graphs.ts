// Page-level JSON-LD (plan 3.6). The root layout already declares the Person, Organization,
// WebSite, WebApplication and SoftwareSourceCode nodes; these graphs point to them by @id and
// never repeat them. Rules: no `license` (all rights reserved), no `distribution` (there is no
// download), no counts in static strings, and every fact here is also visible on its page.
import { patternsAsOf, type CaseCatalogue, type PatternsPayload, type RegimeSummary } from "./data";
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

export function homeGraph(): JsonLdGraph {
  return graph(webPage("/", undefined, { about: ref(APP_ID), mainEntity: ref(APP_ID) }));
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

export function disclaimerGraph(): JsonLdGraph {
  return graph(webPage("/disclaimer"), breadcrumb("/disclaimer"));
}
