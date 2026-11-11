import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { ShareButton } from "@/components/reference/ShareButton";
import { SubscribeControl } from "@/components/upcoming/SubscribeControl";
import { LocalDateTime } from "@/components/upcoming/LocalDateTime";
import { RecentTracker } from "@/components/retention/RecentTracker";
import { eventPath } from "@/lib/events/eventId";
import {
  findYearList,
  YEAR_LISTS,
  yearListPath,
  yearListStatus,
  type YearList,
} from "@/lib/events/yearLists";
import { getEvent } from "@/lib/seo/data";
import { yearPageGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const revalidate = 300;

// Rendered on demand (and cached): the list is published only when it is complete.
export function generateStaticParams() {
  return [];
}

async function loadList(year: string, slug: string): Promise<YearList | null> {
  const list = findYearList(year, slug);
  if (!list) return null;
  const found = await Promise.all(list.entries.map((entry) => getEvent(entry.id)));
  return yearListStatus(list, found).complete ? list : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string; list: string }>;
}): Promise<Metadata> {
  const { year, list: slug } = await params;
  const list = findYearList(year, slug);
  if (!list) return { title: "Not found", robots: { index: false, follow: true } };
  const title = `${list.title} · ${SITE_NAME}`;
  const path = yearListPath(list);
  return {
    title: { absolute: title },
    description: list.intro,
    alternates: { canonical: path },
    // Published only when complete, so an existing page is always indexable.
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "en_IN",
      alternateLocale: ["en_US"],
      siteName: SITE_NAME,
      url: urlFor(path),
      title,
      description: list.intro,
    },
    twitter: { card: "summary_large_image", title, description: list.intro },
  };
}

export default async function YearListPage({
  params,
}: {
  params: Promise<{ year: string; list: string }>;
}) {
  const { year, list: slug } = await params;
  const list = await loadList(year, slug);
  if (!list) notFound();
  const path = yearListPath(list);
  const events = await Promise.all(list.entries.map((entry) => getEvent(entry.id)));
  const dateModified =
    events
      .map((event) => event?.last_updated_at)
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.slice(0, 10))
      .sort()
      .at(-1) ?? `${list.year}-01-01`;

  return (
    <PageShell>
      <RecentTracker
        kind="date"
        id={`${list.year}/${list.slug}`}
        title={list.title}
      />
      <JsonLd data={yearPageGraph(path, list.title, list.intro, dateModified)} />
      <div className="mx-auto grid w-full max-w-[760px] gap-8 xl:max-w-none xl:grid-cols-[minmax(0,760px)_18rem] xl:justify-center xl:gap-12">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
            <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
            <span aria-hidden="true"> / </span>
            <Link href="/upcoming" className="hover:text-(--sh-text-1)">Upcoming dates</Link>
          </nav>

          <header className="mt-4">
            <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
              {list.year} · {list.themeName}
            </p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
              {list.heading}
            </h1>
            <p className="mt-4 max-w-[760px] text-body leading-relaxed text-(--sh-text-2) sm:text-strong">
              {list.intro}
            </p>
            <p className="mt-2 text-meta text-(--sh-text-3)">
              Source:{" "}
              <a
                href={list.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
              >
                {list.source.label}
              </a>
              . Times are shown in your time zone.
            </p>
          </header>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-meta text-(--sh-text-3)">
              All {list.entries.length} dates are in the data.
            </p>
            <SubscribeControl scope={list.themeSlug} />
            <ShareButton surface="date" url={urlFor(path)} title={list.title} />
          </div>

          <ul className="mt-4">
            {list.entries.map((entry, index) => {
              const event = events[index];
              return (
                <li
                  key={entry.id}
                  data-upcoming-row=""
                  className="grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 border-b border-(--sh-line-1) py-3 last:border-b-0 sm:flex sm:flex-wrap"
                >
                  <span className="w-24 shrink-0 text-micro uppercase tracking-[0.08em] text-(--sh-text-3) sm:w-[8.5rem]">
                    {event ? (
                      <LocalDateTime
                        startDate={event.start_date}
                        startTime={event.start_time}
                        startUtc={event.start_utc}
                        timezone={event.timezone}
                        allDay={event.all_day}
                        part="date"
                        long
                      />
                    ) : (
                      entry.date
                    )}
                  </span>
                  <span className="min-w-0 text-body text-(--sh-text-1) sm:flex-1">
                    {event ? (
                      <Link
                        href={eventPath(entry.id)}
                        className="underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current focus-visible:decoration-current"
                      >
                        {event.name}
                      </Link>
                    ) : (
                      entry.listed
                    )}
                    {event && !event.all_day ? (
                      <span className="ml-2 text-micro text-(--sh-text-3)">
                        <LocalDateTime
                          startDate={event.start_date}
                          startTime={event.start_time}
                          startUtc={event.start_utc}
                          timezone={event.timezone}
                          allDay={event.all_day}
                          part="time"
                        />
                      </span>
                    ) : null}
                  </span>
                  <span className="col-start-2 flex flex-wrap items-center gap-3 text-micro sm:col-auto">
                    <Link
                      href={eventPath(entry.id)}
                      className="hidden min-h-11 items-center text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current sm:inline-flex sm:min-h-0"
                    >
                      Event page
                    </Link>
                    {list.sharedSource ? null : (
                      <a
                        href={entry.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center text-(--sh-text-3) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current sm:min-h-0"
                      >
                        Official page
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-8 border-t border-(--sh-line-1) pt-4 text-micro leading-relaxed text-(--sh-text-3)">
            {list.sharedSource
              ? "Every date above is on the official calendar linked at the top. "
              : "Each date links to the official page that names it. "}
            StrikeHike lists dates only; it does not say what will happen on them.
          </p>
        </div>

        <aside className="min-w-0 border-t border-(--sh-line-1) pt-5 xl:sticky xl:top-(--sh-header-clear) xl:self-start xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          <h2 className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
            Other date lists
          </h2>
          <ul className="mt-2 space-y-1">
            {YEAR_LISTS.filter((other) => other !== list).map((other) => (
              <li key={yearListPath(other)}>
                <Link
                  href={yearListPath(other)}
                  className="inline-flex min-h-10 items-center text-meta text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
                >
                  {other.title}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={`/upcoming/${list.themeSlug}`}
                className="inline-flex min-h-10 items-center text-meta text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
              >
                All {list.themeName} dates
              </Link>
            </li>
            <li>
              <Link
                href="/upcoming"
                className="inline-flex min-h-10 items-center text-meta text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
              >
                Upcoming dates
              </Link>
            </li>
          </ul>
        </aside>
      </div>

      <div className="mx-auto mt-10 w-full max-w-[760px] xl:max-w-none">
        <SiteColophon current={path} />
      </div>
    </PageShell>
  );
}
