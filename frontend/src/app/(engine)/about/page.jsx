import Link from "next/link";
import { MeasurementToggle } from "@/components/analytics/MeasurementToggle";
import { PageShell } from "@/components/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { CONTACT_URL } from "@/lib/contact";
import { aboutGraph } from "@/lib/seo/graphs";
import { PERSON_URL } from "@/lib/seo/site";

// A plain, server-rendered account of the site: what it is and is not, how the
// numbers are made, where the data come from, who builds it and how visits are
// counted. Every sentence is composed from what the other views already say, so
// nothing here is a new claim. A server component: static, no motion.

const LINK =
  "underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]";

const SECTION =
  "mt-6 max-w-xl space-y-4 border-t border-(--sh-line-1) pt-5 text-body leading-relaxed text-pretty text-black/70 dark:text-white/70 sm:text-strong";

const HEADING =
  "text-strong font-semibold tracking-[-0.02em] text-black/80 dark:text-white/80";

export default function AboutPage() {
  return (
    <PageShell>
      <header>
        <p className="text-micro uppercase tracking-[0.2em] text-[#a83a27] dark:text-[#ff8b77]">
          About the engine
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl">
          About StrikeHike
        </h1>
      </header>

      <section className={SECTION} aria-labelledby="about-what-heading">
        <h2 id="about-what-heading" className={HEADING}>
          What StrikeHike is, and what it is not
        </h2>
        <p>
          StrikeHike is one person&apos;s public research project. It sets the US
          macro record and market history beside the planetary sky, date by
          date, so patterns can be examined without mistaking correlation for
          certainty. It is descriptive historical research: it is not
          investment advice and not a forecast. The Core Index, its warnings and
          the pattern comparisons all describe history, and they can be wrong.
          The full statement, with the limits of each series, is on{" "}
          <Link href="/disclaimer" className={LINK}>
            Disclaimer
          </Link>
          .
        </p>
      </section>

      <section className={SECTION} aria-labelledby="about-how-heading">
        <h2 id="about-how-heading" className={HEADING}>
          How it works
        </h2>
        <p>
          Two records sit side by side. The first is the market: a weekly Core
          Index from December 1928, decided at the Friday close, that reads the
          S&amp;P 500&apos;s trend and volatility with credit spreads,
          unemployment and the yield curve, on a −50 to +50 scale. The second is
          the sky: sidereal planetary positions for any date from 13 July 1906 to
          31 December 2027, computed with the Swiss Ephemeris.
        </p>
        <p>
          From those two records the site shows a few things.{" "}
          <Link href="/regime" className={LINK}>
            Regime
          </Link>{" "}
          charts every NBER recession since 1854 beside the market series.{" "}
          <Link href="/convergence" className={LINK}>
            Convergence
          </Link>{" "}
          sets any two market declines since 1871 side by side.{" "}
          <Link href="/patterns" className={LINK}>
            Study of Patterns
          </Link>{" "}
          places today&apos;s market beside its closest past setups. Each page
          carries its own <em>Method &amp; limits</em> note that explains the
          rule behind the numbers and how the figures are worked out.
        </p>
        <p>
          The sky number, &ldquo;sky activity&rdquo;, ranks the day&apos;s
          planetary geometry against the past events in StrikeHike&apos;s own
          catalogue: 50 means busier than half of them, 99 busier than almost
          all. The geometry match finds past dates whose planetary positions are
          closest to a chosen date. Both describe the sky, not markets, and
          neither says anything about what will happen.
        </p>
      </section>

      <section className={SECTION} aria-labelledby="about-data-heading">
        <h2 id="about-data-heading" className={HEADING}>
          Data sources
        </h2>
        <p>
          Market and macro data come from FRED, the World Bank,
          Blockchain.com and Yahoo Finance, each with its own limits; NBER
          recession windows are month-precise and dated after the fact.
          Planetary positions are Swiss Ephemeris calculations in the Lahiri
          sidereal frame. The{" "}
          <Link href="/disclaimer" className={LINK}>
            Disclaimer
          </Link>{" "}
          page names the exact series and their known gaps;{" "}
          <Link href="/upcoming" className={LINK}>
            Upcoming dates
          </Link>{" "}
          lists scheduled releases, decisions, eclipses and festivals from
          official calendars, with a source link on every event.
        </p>
        <p>
          The historical events used for the geometry comparisons are a curated
          list kept in the project&apos;s own repository, not a live feed.
        </p>
      </section>

      <section className={SECTION} aria-labelledby="about-who-heading">
        <h2 id="about-who-heading" className={HEADING}>
          Who builds it
        </h2>
        <p>
          StrikeHike is built and run by Prakash Kantumutchu (KP). His other
          work lives at{" "}
          <a href={PERSON_URL} rel="author" className={LINK}>
            thisiskp.in
          </a>
          ; the source for this site is on{" "}
          <a
            href="https://github.com/kpdagrt22/strikehike-monorepo"
            className={LINK}
          >
            GitHub
          </a>
          . There is no team and no sponsor: the data, the ephemeris and the
          small server are paid for by the{" "}
          <a href={CONTACT_URL} className={LINK}>
            support
          </a>{" "}
          linked at the foot of every page.
        </p>
      </section>

      <section className={SECTION} aria-labelledby="about-privacy-heading">
        <h2 id="about-privacy-heading" className={HEADING}>
          Privacy
        </h2>
        <p>
          StrikeHike counts visits with its own measurement, on its own server.
          Nothing is sent to another company, and there are no tracking cookies
          and no ads. What is counted, what is never collected and how to turn
          it off are set out below; the switch stops the counting on this
          browser.
        </p>
        <MeasurementToggle />
      </section>

      <section className={SECTION} aria-labelledby="about-contact-heading">
        <h2 id="about-contact-heading" className={HEADING}>
          Contact
        </h2>
        <p>
          Questions, corrections and feedback all help. The feedback route is
          the enquiry form on thisiskp.in:{" "}
          <a
            href={CONTACT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-1.5 ${LINK}`}
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
          .
        </p>
      </section>

      <SiteColophon current="/about" />
      <JsonLd data={aboutGraph()} />
    </PageShell>
  );
}
