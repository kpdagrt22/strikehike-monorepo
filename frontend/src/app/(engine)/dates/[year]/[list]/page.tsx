import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { SubscribeControl } from "@/components/upcoming/SubscribeControl";
import { LocalDateTime } from "@/components/upcoming/LocalDateTime";
import { eventPath } from "@/lib/events/eventId";
import { findYearList, yearListPath, yearListStatus, type YearList } from "@/lib/events/yearLists";
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
    <main className="relative h-full w-full overflow-y-auto overflow-x-hidden pb-24">
      <JsonLd data={yearPageGraph(path, list.title, list.intro, dateModified)} />
      <div className="w-full max-w-3xl px-3 pt-(--sh-header-clear) sm:px-5 lg:px-8">
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
          <p className="mt-4 max-w-2xl text-body leading-relaxed text-(--sh-text-2) sm:text-strong">
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

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-(--sh-line-1) py-2">
          <p className="text-meta text-(--sh-text-3)">
            All {list.entries.length} dates are in the data.
          </p>
          <SubscribeControl scope={list.themeSlug} />
        </div>

        <ul className="mt-2">
          {list.entries.map((entry, index) => {
            const event = events[index];
            return (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-(--sh-line-1) py-3 last:border-b-0"
              >
                <span className="w-[8.5rem] shrink-0 text-micro uppercase tracking-[0.08em] text-(--sh-text-3)">
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
                <span className="min-w-0 flex-1 text-body text-(--sh-text-1)">
                  {event?.name ?? entry.listed}
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
                <span className="flex items-center gap-3 text-micro">
                  <Link
                    href={eventPath(entry.id)}
                    className="inline-flex min-h-11 items-center text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current sm:min-h-0"
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

        <SiteColophon current={path} />
      </div>
    </main>
  );
}
