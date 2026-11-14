// Generate public/llms.txt from the route registry and the local stores.
// Run by `npm run build` (prebuild), by the approval helpers, and by the unit test.
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ABOUT_TERMS } from "../src/lib/seo/faq.ts";
import {
  PERSON_NAME,
  PERSON_URL,
  REPO_URL,
  absoluteUrl,
} from "../src/lib/seo/site.ts";
import { readLedger } from "../src/lib/ledger/store.ts";
import { approvedRoundups } from "../src/lib/roundup/store.ts";
import { weekLabel } from "../src/lib/roundup/week.ts";
import { readClaimTests } from "../src/lib/tested/store.ts";

const CANONICAL =
  "StrikeHike (strikehike.com) is a free research site by Prakash Kantumutchu (KP) that sets the US market and macro record beside the planetary sky, date by date; descriptive history, not investment advice or a forecast.";

const VIEWS = [
  ["/", "Orrery", "A 3D orrery for any date from July 1906 to December 2027, beside dated world events and past and upcoming geometry matches."],
  ["/regime", "Regime", "Every NBER recession since 1854, the weekly Core Index on a -50 to +50 scale, and the market series on one chart."],
  ["/convergence", "Convergence", "Any two market declines since 1871, side by side: peak, low, depth, recovery and the sky at each peak."],
  ["/patterns", "Study of Patterns", "Today's S&P 500 and Nifty 50 beside their closest past setups, plus the 120-year mirror."],
  ["/this-week", "This week", "The latest approved weekly roundup and the archive of every approved week."],
  ["/tested", "Tested", "Popular sky claims measured against the daily S&P 500 record, including the null results."],
  ["/recessions", "Recessions", "Every NBER recession window since 1854, with its dates and the market record around it."],
  ["/declines", "20% falls", "Every fall of 20% or more in the daily S&P 500 since 1928: dates, depth, and whether the trend warning came before the first 20%. Misses included."],
  ["/upcoming", "Upcoming dates", "Scheduled releases, central-bank decisions, eclipses, solstices and festivals for the next 12 months."],
  ["/ledger", "Ledger", "The append-only public record of approved weekly roundups."],
  ["/about", "About", "What StrikeHike is and is not, how it works, where the data come from, and how visits are counted."],
  ["/disclaimer", "Disclaimer", "The full statement of limits and the data sources."],
];

const SOURCES = [
  ["/recessions", "NBER recession windows since 1854"],
  ["/declines", "Daily S&P 500 falls of 20% or more since 1928"],
  ["/tested", "Daily S&P 500 claim tests"],
  ["/ledger", "Approved weekly roundups"],
];

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

const DATA_SOURCES = [
  "- Recessions: NBER business-cycle dates via FRED (USREC), month-precise and dated after the fact: https://fred.stlouisfed.org/series/USREC",
  "- US stocks, 1871–1927: the Cowles Commission index of common stocks, monthly average (NBER Macrohistory Database, via FRED): https://fred.stlouisfed.org/series/M1125AUSM343NNBR",
  "- US stocks from 30 Dec 1927: daily S&P closes from Yahoo Finance (^GSPC), the S&P 90 until 4 Mar 1957 and the S&P 500 after, with official S&P Dow Jones Indices closes via FRED where Yahoo's differ. Prices exclude dividends.",
  "- Nifty 50: Yahoo Finance (^NSEI), daily from 17 Sep 2007.",
  "- Gold: World Bank Pink Sheet, London bullion, monthly: https://www.worldbank.org/en/research/commodity-markets",
  "- Bitcoin: Blockchain.com daily market price from 18 Aug 2010: https://www.blockchain.com/explorer/charts/market-price",
  "- Treasury bonds: a 7.5-duration 10-year Treasury total-return model.",
  "- Planetary positions: Swiss Ephemeris 2.10.03, Lahiri sidereal, 1900–2035: https://www.astro.com/swisseph/",
  `- Source code: ${REPO_URL}`,
];

export async function buildLlms() {
  const [claims, rounds, ledger] = await Promise.all([
    readClaimTests(),
    approvedRoundups(),
    readLedger().catch(() => []),
  ]);
  const latest = rounds[0] ?? null;
  const latestLedger = ledger.at(-1) ?? null;
  const countWord = NUMBER_WORDS[claims.length] ?? String(claims.length);
  const testedView =
    claims.length === 0
      ? "No popular sky claims measured against the daily S&P 500 record yet."
      : `${countWord[0].toUpperCase()}${countWord.slice(1)} popular sky claims measured against the daily S&P 500 record, including the null results.`;
  const views = VIEWS.map(([path, name, what]) =>
    path === "/tested" ? [path, name, testedView] : [path, name, what],
  );
  const lines = [
    "# StrikeHike",
    "",
    `> ${CANONICAL}`,
    "",
    "Every number on StrikeHike describes the past. Each page shows the date its data run to; cite that date with any figure. The site publishes no calls on future prices.",
    "",
    "## Views",
    "",
    ...views.map(([path, name, what]) => `- [${name}](${absoluteUrl(path)}): ${what}`),
    "",
    "## Definitions",
    "",
    ...ABOUT_TERMS.map((term) => `- ${term.name}: ${term.description}`),
    "- Market decline (Convergence): starts at the highest close before a fall of at least 15% (US stocks, the Nifty 50, the Treasury bond model), 25% (gold, monthly average) or 50% (Bitcoin). Each case gives its peak, its low and depth, and the date it was back at its peak, or that it has not been.",
    "- 120-year mirror (Study of Patterns): the latest 12 months of the US stock index beside the same 12 months exactly 120 years earlier, on monthly averages.",
    "",
    "## Tested claims",
    "",
    ...claims.map((claim) => {
      const n = claim.published && claim.comparison ? claim.comparison.in.n : null;
      const result = claim.published
        ? claim.result.replace(/\.$/, "")
        : "not published (too few non-overlapping windows)";
      const nText = n === null ? "" : `; n = ${n} windows`;
      return `- [${claim.title}](${absoluteUrl(`/tested/${claim.id}`)}): ${result}${nText}; data to ${claim.series.end}.`;
    }),
    "",
    "## This week",
    "",
    latest
      ? `- Latest: [Week of ${weekLabel(latest.week)}](${absoluteUrl(`/this-week/${latest.week}`)}).`
      : "- No approved week yet.",
    `- [Archive](${absoluteUrl("/this-week")}) of every approved week.`,
    `- [RSS](${absoluteUrl("/this-week/rss.xml")}).`,
    "",
    "## Ledger",
    "",
    `- [Published ledger](${absoluteUrl("/ledger")}) and [ledger.jsonl](${absoluteUrl("/ledger.jsonl")}).`,
    latestLedger
      ? `- Latest line: ${latestLedger.week}, published ${latestLedger.published_at}, reading ${latestLedger.reading.core_index} (${latestLedger.reading.label}).`
      : "- No ledger line yet.",
    "- Each line carries the SHA-256 of the LF-normalised roundup bytes and the hash of the line before it, so a silent edit is detectable. The ledger records what was published, not performance.",
    "- The ledger JSONL is published under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/",
    "",
    "## Recessions and declines",
    "",
    `- [Recessions](${absoluteUrl("/recessions")}): every NBER recession since 1854.`,
    `- [20% falls](${absoluteUrl("/declines")}): every fall of 20% or more in the daily S&P 500 since 1928, with its depth and the trend warning's record.`,
    "",
    "## Upcoming and dates",
    "",
    `- [Upcoming dates](${absoluteUrl("/upcoming")}): the next 12 months.`,
    `- Themes: [Finance](${absoluteUrl("/upcoming/finance")}), [Science](${absoluteUrl("/upcoming/science")}), [Culture/Religion](${absoluteUrl("/upcoming/culture-religion")}).`,
    `- Calendar feeds: [all](${absoluteUrl("/calendar/all.ics")}), [finance](${absoluteUrl("/calendar/finance.ics")}), [science](${absoluteUrl("/calendar/science.ics")}), [culture/religion](${absoluteUrl("/calendar/culture-religion.ics")}).`,
    "",
    "## Data sources",
    "",
    ...DATA_SOURCES,
    "",
    "## About",
    "",
    `- [About](${absoluteUrl("/about")}): what the site is and is not.`,
    `- [Disclaimer](${absoluteUrl("/disclaimer")}): limits and data sources.`,
    `- Built and run by ${PERSON_NAME} (${PERSON_URL}).`,
    "",
    "## Not claimed",
    "",
    "- No forecast, target, signal or investment advice.",
    "- The sky layer is a historical lens, not a cause.",
    "- A geometry match is a similarity in planetary positions, not a prediction.",
    "",
    "## How to cite",
    "",
    "Cite as: StrikeHike, <page title>, <page URL>, data to <the date shown on that page>.",
    `For example: StrikeHike, Tested, ${absoluteUrl("/tested")}, data to the date shown on the claim page.`,
    "",
    "## Sources",
    "",
    ...SOURCES.map(([path, what]) => `- [${what}](${absoluteUrl(path)})`),
    "",
  ];
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const text = await buildLlms();
  await writeFile("public/llms.txt", text, "utf8");
  console.log("wrote public/llms.txt");
}
