import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { CONTACT_URL } from "@/lib/contact";
import { disclaimerGraph } from "@/lib/seo/graphs";
import { PERSON_URL } from "@/lib/seo/site";

// Composed only from what the views already say: the "not investment advice"
// and "not a forecast" lines, the data and sky notes in Method & limits, and
// the Info panel's heading and enquiry link; plus the owner-approved maker and
// sources paragraph (SEO plan 3.7f). No terms, privacy or liability text (the
// owner's). A server component: static, no motion. The light-theme
// eyebrow is #a83a27, not #c0442f, to keep 4.5:1 over the brand pill's shadow.
// "month-precise" stays whole through nowrap, not U+2011: Onest has no U+2011
// glyph, so a non-breaking hyphen would fall back to a system font.

const LINK =
  "underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]";

// The maker and the sources, each linked to the record the data come from (the
// same addresses as llms.txt and the pages' JSON-LD). Plain links: no nofollow.
const SOURCES = {
  usrec: "https://fred.stlouisfed.org/series/USREC",
  cowles: "https://fred.stlouisfed.org/series/M1125AUSM343NNBR",
  sp500: "https://finance.yahoo.com/quote/%5EGSPC/",
  nifty: "https://finance.yahoo.com/quote/%5ENSEI/",
  gold: "https://www.worldbank.org/en/research/commodity-markets",
  bitcoin: "https://www.blockchain.com/explorer/charts/market-price",
  ephemeris: "https://www.astro.com/swisseph/",
};

export default function DisclaimerPage() {
  return (
    <main className="relative h-full w-full scroll-pt-(--sh-header-clear) overflow-y-auto overflow-x-hidden pb-24">
      <div className="mx-auto w-full max-w-[1600px] px-3 pt-(--sh-header-clear) sm:px-5 lg:px-8">
        <header>
          <p className="text-micro uppercase tracking-[0.2em] text-[#a83a27] dark:text-[#ff8b77]">
            About the engine
          </p>
          <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl">
            Disclaimer
          </h1>
        </header>

        <div className="mt-6 max-w-xl space-y-4 border-t border-(--sh-line-1) pt-5 text-body leading-relaxed text-pretty text-black/70 dark:text-white/70 sm:text-strong">
          <p>
            StrikeHike is descriptive historical research with astronomical
            context. It sets the US macro record and market history beside
            the planetary sky, date by date, so patterns can be examined without
            mistaking correlation for certainty. It is not investment advice
            and not a forecast. StrikeHike is not registered with SEBI (India)
            or any other regulator as an investment adviser or research
            analyst, and nothing on this site is a recommendation to buy, sell
            or hold any security.
          </p>
          <p>
            The Core Index, its warnings and the pattern comparisons describe
            history, and they can be wrong. The Core Index bands are descriptive
            states, not allocations or actions: research, not investment
            advice. Where a view shows how past readings fared, it is a
            historical record, not a forecast; past scoring does not carry
            into the future.
          </p>
          <p>
            Market and macro data come from FRED, the World Bank,
            Blockchain.com and Yahoo Finance, each with its own limits. NBER
            recession windows are{" "}
            <span className="whitespace-nowrap">month-precise</span>{" "}
            and dated after the fact.
            Before 30&nbsp;December&nbsp;1927 the US stock series is the
            Cowles monthly index, and until 4&nbsp;March&nbsp;1957 it is the
            S&amp;P&nbsp;90, the S&amp;P&nbsp;500&apos;s predecessor. Before
            1953 the Core Index has fewer stress inputs. Method &amp; limits
            on{" "}
            <Link href="/regime" className={LINK}>
              Regime
            </Link>
            ,{" "}
            <Link href="/convergence" className={LINK}>
              Convergence
            </Link>{" "}
            and{" "}
            <Link href="/patterns" className={LINK}>
              Study of Patterns
            </Link>{" "}
            gives the details.
          </p>
          <p>
            Planetary positions are astronomical calculations (Swiss
            Ephemeris, Lahiri sidereal) shown as context. The sky, the energy
            score and the dates whose geometry echoes a past event are a
            historical correspondence lens: not an economic input and not a
            causal input to the Core Index.
          </p>
          <p>
            StrikeHike is built and run by Prakash Kantumutchu (KP),{" "}
            <a href={PERSON_URL} rel="author" className={LINK}>
              thisiskp.in
            </a>
            . Sources: NBER recession dates via{" "}
            <a href={SOURCES.usrec} className={LINK}>
              FRED (USREC)
            </a>{" "}
            · the Cowles stock index, 1871–1927, via{" "}
            <a href={SOURCES.cowles} className={LINK}>
              FRED
            </a>{" "}
            · S&amp;P closes from{" "}
            <a href={SOURCES.sp500} className={LINK}>
              Yahoo Finance
            </a>
            , with official closes via FRED where they differ · Nifty 50 from{" "}
            <a href={SOURCES.nifty} className={LINK}>
              Yahoo Finance
            </a>{" "}
            · gold from{" "}
            <a href={SOURCES.gold} className={LINK}>
              the World Bank
            </a>{" "}
            · Bitcoin from{" "}
            <a href={SOURCES.bitcoin} className={LINK}>
              Blockchain.com
            </a>{" "}
            · planetary positions from{" "}
            <a href={SOURCES.ephemeris} className={LINK}>
              the Swiss Ephemeris
            </a>{" "}
            (Lahiri sidereal).
          </p>
        </div>

        <footer className="mt-8 flex max-w-xl flex-wrap items-center gap-x-3 gap-y-1 border-t border-(--sh-line-1) pt-4 text-micro text-black/60 dark:text-white/60">
          <a
            href={CONTACT_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby="disclaimer-enquiry-note"
            className={`inline-flex items-center gap-1.5 pointer-coarse:min-h-11 ${LINK}`}
          >
            Write to KP
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5.5 10.5l5-5M6.5 5.5h4v4" />
            </svg>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <span id="disclaimer-enquiry-note">
            Opens the enquiry form on thisiskp.in
          </span>
        </footer>

        <SiteColophon current="/disclaimer" />
      </div>
      <JsonLd data={disclaimerGraph()} />
    </main>
  );
}
