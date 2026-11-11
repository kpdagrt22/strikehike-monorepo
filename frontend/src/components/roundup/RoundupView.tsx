import Link from "next/link";
import { ShareButton } from "@/components/reference/ShareButton";
import type { Roundup } from "@/lib/roundup/store";
import { weekLabel, isoWeekOf } from "@/lib/roundup/week";
import { urlFor } from "@/lib/seo/site";

const DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function RoundupView({ roundup }: { roundup: Roundup }) {
  const path = `/this-week/${roundup.week}`;
  const readingDate = roundup.regime
    ? new Date(`${roundup.regime.as_of}T00:00:00Z`)
    : null;
  const readingWeek = roundup.regime
    ? isoWeekOf(roundup.regime.as_of)
    : null;
  const staleReading =
    readingDate && roundup.start
      ? (new Date(`${roundup.start}T00:00:00Z`).getTime() -
          readingDate.getTime()) /
          86_400_000 >
        7
      : false;
  return (
    <article data-roundup={roundup.week}>
      <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
        <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/this-week" className="hover:text-(--sh-text-1)">This week</Link>
        <span aria-hidden="true"> / </span>
        <span>{roundup.week}</span>
      </nav>

      <header className="mt-4 max-w-[760px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
          Weekly roundup
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          This week: macro + sky
        </h1>
        <p className="mt-3 text-body text-(--sh-text-2)">
          {weekLabel(roundup.week)} · {roundup.week}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ShareButton
            surface="roundup"
            url={urlFor(path)}
            title={`This week: macro + sky, ${roundup.week}`}
          />
          <a
            href="/this-week/rss.xml"
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-1) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
          >
            RSS
          </a>
        </div>
      </header>

      {roundup.regime ? (
        <section aria-labelledby="roundup-regime" className="mt-8 max-w-[760px]">
          <h2 id="roundup-regime" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
            Regime
          </h2>
          <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
            {roundup.lines?.regime}{" "}
            Latest reading: week of{" "}
            {readingDate ? DATE.format(readingDate) : roundup.regime.as_of}
            {staleReading && readingWeek
              ? ` (from ${readingWeek}, before ${roundup.week})`
              : ""}
            .
          </p>
        </section>
      ) : null}

      {roundup.themes?.length ? (
        <section aria-labelledby="roundup-dates" className="mt-8 max-w-[760px]">
          <h2 id="roundup-dates" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
            Dates
          </h2>
          <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
            {roundup.lines?.dates}
          </p>
          <div className="mt-3 space-y-4">
            {roundup.themes.map((theme) => (
              <div key={theme.id}>
                <h3 className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
                  {theme.name}
                </h3>
                <ul className="mt-1">
                  {theme.events.map((event) => (
                    <li key={event.id} className="border-b border-(--sh-line-1) py-2 last:border-b-0">
                      <Link
                        href={event.path}
                        className="text-body text-(--sh-text-1) underline decoration-transparent underline-offset-2 hover:decoration-current"
                      >
                        {event.name}
                      </Link>
                      <span className="ml-2 text-micro text-(--sh-text-3)">
                        {DATE.format(new Date(`${event.start_date}T00:00:00Z`))}
                        {event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {roundup.sky?.length ? (
        <section aria-labelledby="roundup-sky" className="mt-8 max-w-[760px]">
          <h2 id="roundup-sky" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
            Sky
          </h2>
          <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
            {roundup.lines?.sky}
          </p>
          <ul className="mt-2">
            {roundup.sky.map((event) => (
              <li key={event.id} className="border-b border-(--sh-line-1) py-2 last:border-b-0">
                <Link
                  href={event.path}
                  className="text-body text-(--sh-text-1) underline decoration-transparent underline-offset-2 hover:decoration-current"
                >
                  {event.name}
                </Link>
                <span className="ml-2 text-micro text-(--sh-text-3)">
                  {DATE.format(new Date(`${event.start_date}T00:00:00Z`))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}
