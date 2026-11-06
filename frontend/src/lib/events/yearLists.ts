// Year pages (SEO-03): one page per complete official list. Each entry was read on its
// official page on 2026-11-06. A page is published only when every entry is in the active
// bundle on the listed date (yearListStatus); otherwise it is a 404, never a partial list.

export type YearListEntry = {
  /** The bundle's event id. */
  id: string;
  /** The listed day (YYYY-MM-DD): the decision day, or the day of greatest eclipse. */
  date: string;
  /** How the official page lists it. */
  listed: string;
  /** The official page for this entry. */
  officialUrl: string;
};

export type YearList = {
  year: string;
  slug: string;
  title: string;
  heading: string;
  intro: string;
  /** The calendar feed (and theme page) the list belongs to. */
  themeSlug: "finance" | "science";
  themeName: string;
  source: { label: string; url: string };
  /** True when every entry shares the list's own source page. */
  sharedSource: boolean;
  entries: YearListEntry[];
};

const FED_CALENDAR = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";

function fomc(month: string, days: string, decision: string): YearListEntry {
  return {
    id: `finance:curated_upcoming:fomc-2027-${month}`,
    date: decision,
    listed: days,
    officialUrl: FED_CALENDAR,
  };
}

// NASA GSFC per-eclipse pages, linked from the 2021-2030 decade tables.
const NASA = "https://eclipse.gsfc.nasa.gov";

export const YEAR_LISTS: YearList[] = [
  {
    year: "2027",
    slug: "fomc-meetings",
    title: "FOMC meetings 2027",
    heading: "FOMC meetings in 2027",
    intro:
      "The eight scheduled meetings of the Federal Open Market Committee in 2027, as the Federal Reserve lists them. Each is a two-day meeting; the policy statement comes on the second day. The Fed notes that each date is tentative until confirmed at the meeting before it.",
    themeSlug: "finance",
    themeName: "Finance",
    source: { label: "Federal Reserve meeting calendar", url: FED_CALENDAR },
    sharedSource: true,
    entries: [
      fomc("01", "January 26–27", "2027-01-27"),
      fomc("03", "March 16–17", "2027-03-17"),
      fomc("04", "April 27–28", "2027-04-28"),
      fomc("06", "June 8–9", "2027-06-09"),
      fomc("07", "July 27–28", "2027-07-28"),
      fomc("09", "September 14–15", "2027-09-15"),
      fomc("10", "October 26–27", "2027-10-27"),
      fomc("12", "December 7–8", "2027-12-08"),
    ],
  },
  {
    year: "2027",
    slug: "eclipses",
    title: "Eclipses 2027",
    heading: "Eclipses in 2027",
    intro:
      "Every solar and lunar eclipse of 2027 on NASA's 2021–2030 eclipse tables: two solar eclipses and three penumbral lunar eclipses. Times are the instant of greatest eclipse.",
    themeSlug: "science",
    themeName: "Science",
    source: {
      label: "NASA solar and lunar eclipse tables, 2021–2030",
      url: `${NASA}/SEdecade/SEdecade2021.html`,
    },
    sharedSource: false,
    entries: [
      {
        id: "science:astronomy_computed:solar-eclipse-annular-2027-02-06",
        date: "2027-02-06",
        listed: "Annular solar eclipse of 2027 Feb 06",
        officialUrl: `${NASA}/SEpath/SEpath2001/SE2027Feb06Apath.html`,
      },
      {
        id: "science:astronomy_computed:lunar-eclipse-penumbral-2027-02-20",
        date: "2027-02-20",
        listed: "Penumbral lunar eclipse of 2027 Feb 20",
        officialUrl: `${NASA}/LEplot/LEplot2001/LE2027Feb20N.pdf`,
      },
      {
        id: "science:astronomy_computed:lunar-eclipse-penumbral-2027-07-18",
        date: "2027-07-18",
        listed: "Penumbral lunar eclipse of 2027 Jul 18",
        officialUrl: `${NASA}/LEplot/LEplot2001/LE2027Jul18N.pdf`,
      },
      {
        id: "science:astronomy_computed:solar-eclipse-total-2027-08-02",
        date: "2027-08-02",
        listed: "Total solar eclipse of 2027 Aug 02",
        officialUrl: `${NASA}/SEpath/SEpath2001/SE2027Aug02Tpath.html`,
      },
      {
        id: "science:astronomy_computed:lunar-eclipse-penumbral-2027-08-17",
        date: "2027-08-17",
        listed: "Penumbral lunar eclipse of 2027 Aug 17",
        officialUrl: `${NASA}/LEplot/LEplot2001/LE2027Aug17N.pdf`,
      },
    ],
  },
];

export function findYearList(year: string, slug: string): YearList | null {
  return YEAR_LISTS.find((list) => list.year === year && list.slug === slug) ?? null;
}

export function yearListPath(list: Pick<YearList, "year" | "slug">): string {
  return `/dates/${list.year}/${list.slug}`;
}

// A listed event still counts once its day has passed (the weekly build marks it completed).
const PRESENT_STATUSES = new Set(["scheduled", "tentative", "completed"]);

type FoundEvent = { start_date: string; status: string } | null | undefined;

export type YearListStatus = {
  complete: boolean;
  /** Entries the bundle lacks, or holds on another date or with another status. */
  missing: { entry: YearListEntry; why: string }[];
};

/** Complete only when every entry is in the bundle, on its listed day, and not cancelled. */
export function yearListStatus(list: YearList, found: FoundEvent[]): YearListStatus {
  const missing: YearListStatus["missing"] = [];
  list.entries.forEach((entry, index) => {
    const event = found[index];
    if (!event) {
      missing.push({ entry, why: "not in the bundle" });
    } else if (event.start_date !== entry.date) {
      missing.push({ entry, why: `in the bundle on ${event.start_date}` });
    } else if (!PRESENT_STATUSES.has(event.status)) {
      missing.push({ entry, why: `status ${event.status}` });
    }
  });
  return { complete: missing.length === 0, missing };
}
