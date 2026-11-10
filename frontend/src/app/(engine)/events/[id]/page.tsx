import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { PageShell } from "@/components/PageShell";
import { LocalDateTime } from "@/components/upcoming/LocalDateTime";
import { UpcomingEventRow } from "@/components/upcoming/UpcomingEventRow";
import { eventCalendarPath, eventIdFromSlug, eventSlug, skyHref } from "@/lib/events/eventId";
import { googleCalendarUrl } from "@/lib/events/googleCalendar";
import { isIndexableEvent } from "@/lib/events/indexing";
import { isHiddenTheme, themeSlug } from "@/lib/events/upcoming";
import { getEvent, getUpcomingAll } from "@/lib/seo/data";
import { eventPageGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const revalidate = 300;

// Every known id renders on demand and is then cached; an unknown id is a 404.
export function generateStaticParams() {
  return [];
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function dateOf(value: string) {
  return DATE.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

function clip(value: string, limit = 155) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 80 ? space : cut.length)}…`;
}

const STATUS_LABELS: Record<string, string> = {
  tentative: "Tentative",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  completed: "Completed",
  unverified: "Unverified",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: slug } = await params;
  const id = eventIdFromSlug(slug);
  const event = id ? await getEvent(id).catch(() => null) : null;
  if (!event) {
    return { title: "Event not found", robots: { index: false, follow: true } };
  }
  const day = dateOf(event.start_date);
  const title = `${event.name} · ${day} · ${SITE_NAME}`;
  const description = clip(
    `${event.name} on ${day} (${event.theme}). ${event.description || "Its date, time and source."}`,
  );
  const decision = isIndexableEvent(event);
  const path = `/events/${eventSlug(event.event_id)}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    robots: decision.index
      ? { index: true, follow: true }
      : { index: false, follow: true },
    openGraph: {
      type: "website",
      locale: "en_IN",
      alternateLocale: ["en_US"],
      siteName: SITE_NAME,
      url: urlFor(path),
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: slug } = await params;
  const id = eventIdFromSlug(slug);
  if (!id) notFound();
  const [event, upcoming] = await Promise.all([
    getEvent(id).catch(() => null),
    getUpcomingAll().catch(() => null),
  ]);
  if (!event) notFound();

  const path = `/events/${eventSlug(event.event_id)}`;
  const day = dateOf(event.start_date);
  const status = event.status === "scheduled" ? null : (STATUS_LABELS[event.status] ?? event.status);
  const sky = skyHref(event);
  const slugTheme = themeSlug(event.theme);
  const hasThemePage = !isHiddenTheme(event.theme);
  const authority = event.authority_url && event.authority_url !== event.source_url ? event.authority_url : null;
  const sourceLabel = event.verification === "computed" ? "Method" : "Source";
  const past = event.kind === "historical" || event.status === "completed" || event.start_date < new Date().toISOString().slice(0, 10);

  // Up to five nearby dates in the same theme (either side of this one).
  const siblings = (upcoming?.themes?.[event.theme]?.events ?? [])
    .filter((other) => other.event_id !== event.event_id)
    .map((other) => ({
      other,
      distance: Math.abs(Date.parse(`${other.start_date}T00:00:00Z`) - Date.parse(`${event.start_date}T00:00:00Z`)),
    }))
    .sort((left, right) => left.distance - right.distance || left.other.start_date.localeCompare(right.other.start_date))
    .slice(0, 5)
    .map(({ other }) => other);

  const asOf = upcoming?.as_of?.slice(0, 10) ?? event.start_date;
  const summary = clip(
    `${event.name} on ${day} (${event.theme}). ${event.description || "Its date, time and source."}`,
  );
  const google = past
    ? null
    : googleCalendarUrl(event, {
        details: `${event.theme} · ${event.name}\n${urlFor(path)}\nListed by StrikeHike. Dates only: StrikeHike does not say what will happen on them.`,
      });

  return (
    <PageShell>
      <JsonLd data={eventPageGraph(path, `${event.name} · ${day}`, summary, asOf)} />
      <div className="mx-auto grid w-full max-w-[760px] gap-8 xl:max-w-none xl:grid-cols-[minmax(0,760px)_20rem] xl:justify-center xl:gap-12">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
            <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
            <span aria-hidden="true"> / </span>
            <Link href="/upcoming" className="hover:text-(--sh-text-1)">Upcoming dates</Link>
          </nav>

          <header className="mt-4">
            <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
              {hasThemePage ? (
                <Link href={`/upcoming/${slugTheme}`} className="hover:underline">
                  {event.theme}
                </Link>
              ) : (
                event.theme
              )}
              {status ? ` · ${status}` : null}
            </p>
            <h1 className="mt-2 text-[1.75rem] font-semibold leading-[1.02] tracking-[-0.04em] text-(--sh-text-1) sm:text-[2.5rem]">
              {event.name}
            </h1>
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-body text-(--sh-text-2) sm:text-strong">
              <span className="font-medium text-(--sh-text-1)">
                <LocalDateTime
                  startDate={event.start_date}
                  startTime={event.start_time}
                  startUtc={event.start_utc}
                  timezone={event.timezone}
                  allDay={event.all_day}
                  part="date"
                  long
                />
              </span>
              {event.all_day ? null : (
                <>
                  <span aria-hidden="true">·</span>
                  <LocalDateTime
                    startDate={event.start_date}
                    startTime={event.start_time}
                    startUtc={event.start_utc}
                    timezone={event.timezone}
                    allDay={event.all_day}
                    part="time"
                  />
                </>
              )}
            </p>
          </header>

          {event.description ? (
            <p className="mt-5 max-w-[760px] text-body leading-relaxed text-(--sh-text-2) sm:text-strong">
              {event.description}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-(--sh-line-1) pt-4 text-meta text-(--sh-text-3)">
            <a
              href={event.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1 underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current sm:min-h-0"
            >
              {sourceLabel}
              <span aria-hidden="true">↗</span>
            </a>
            {authority ? (
              <a
                href={authority}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current sm:min-h-0"
              >
                Authority
                <span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {sky ? (
              <Link
                href={sky}
                className="inline-flex min-h-11 items-center rounded-full border border-(--sh-line-2) px-3 text-meta font-medium text-(--sh-text-1) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover)"
              >
                See the sky on this date
              </Link>
            ) : (
              <p className="text-meta text-(--sh-text-3)">
                This date is outside the orrery&apos;s timeline (1906–2027).
              </p>
            )}
            {past ? null : (
              <a
                href={eventCalendarPath(event.event_id)}
                className="inline-flex min-h-11 items-center rounded-full border border-(--sh-line-1) px-3 text-meta font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover)"
              >
                Add to calendar (.ics)
              </a>
            )}
            {google ? (
              <a
                href={google}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-full border border-(--sh-line-1) px-3 text-meta font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover)"
              >
                Google Calendar
              </a>
            ) : null}
          </div>
        </div>

        {siblings.length > 0 || hasThemePage ? (
          <aside
            aria-labelledby="more-dates"
            className="min-w-0 border-t border-(--sh-line-1) pt-5 xl:sticky xl:top-(--sh-header-clear) xl:self-start xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="more-dates" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
                More {event.theme} dates
              </h2>
              <Link
                href={hasThemePage ? `/upcoming/${slugTheme}` : "/upcoming"}
                className="text-micro font-medium text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
              >
                All {event.theme} dates →
              </Link>
            </div>
            {siblings.length > 0 ? (
              <ul className="mt-2">
                {siblings.map((other) => (
                  <UpcomingEventRow
                    key={other.event_id}
                    event={other}
                    themeSlug={slugTheme}
                    actions={false}
                    linkTitle
                  />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-meta leading-relaxed text-(--sh-text-3)">
                No other {event.theme} dates are listed in the next 12 months.
              </p>
            )}
          </aside>
        ) : null}
      </div>

      <div className="mx-auto mt-10 w-full max-w-[760px] xl:max-w-none">
        <SiteColophon current={path} />
      </div>
    </PageShell>
  );
}
