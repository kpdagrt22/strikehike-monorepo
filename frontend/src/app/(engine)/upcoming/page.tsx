import type { Metadata } from "next";
import Link from "next/link";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { EventSourceLink } from "@/components/upcoming/EventSourceLink";
import { LocalDateTime } from "@/components/upcoming/LocalDateTime";
import { SubscribeControl } from "@/components/upcoming/SubscribeControl";
import { UpcomingFilterLinks } from "@/components/upcoming/UpcomingFilterLinks";
import { UpcomingPageTracker } from "@/components/upcoming/UpcomingPageTracker";
import { orderedThemes, statusLabel, type OrderedTheme } from "@/lib/events/upcoming";
import { getUpcoming, type UpcomingEventPayload } from "@/lib/seo/data";
import { absoluteUrl, SITE_NAME } from "@/lib/seo/site";

export const revalidate = 300;

const TITLE = "Upcoming dates · StrikeHike";
const DESCRIPTION =
  "Scheduled US economic releases, central-bank decisions, eclipses, solstices and religious festivals for the next 12 months, from official calendars. Subscribe in your calendar.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/upcoming" },
  openGraph: {
    type: "website",
    locale: "en_IN",
    alternateLocale: ["en_US"],
    siteName: SITE_NAME,
    url: absoluteUrl("/upcoming"),
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const VISIBLE_SLUGS = new Set(["science", "finance", "culture-religion"]);

function parseFilter(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value.join(",") : value ?? "";
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => VISIBLE_SLUGS.has(part));
}

function EventRow({
  event,
  theme,
}: {
  event: UpcomingEventPayload;
  theme: OrderedTheme;
}) {
  const status = statusLabel(event.status);
  return (
    <li className="border-b border-(--sh-line-1) py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="w-[5.25rem] shrink-0 text-micro uppercase tracking-[0.08em] text-(--sh-text-3)">
          <LocalDateTime
            startDate={event.start_date}
            startTime={event.start_time}
            startUtc={event.start_utc}
            timezone={event.timezone}
            allDay={event.all_day}
            part="date"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium leading-snug text-(--sh-text-1)">
            {event.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-(--sh-text-3)">
            <LocalDateTime
              startDate={event.start_date}
              startTime={event.start_time}
              startUtc={event.start_utc}
              timezone={event.timezone}
              allDay={event.all_day}
              part="time"
            />
            {status ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{status}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <EventSourceLink
              eventId={event.event_id}
              eventName={event.name}
              theme={theme.slug}
              daysUntil={event.days_until}
              sourceUrl={event.source_url}
              verification={event.verification}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

function ThemeSection({ theme }: { theme: OrderedTheme }) {
  const events = theme.data.events ?? [];
  const first = events.slice(0, 5);
  const rest = events.slice(5);
  const headingId = `upcoming-${theme.slug}`;
  return (
    <section
      aria-labelledby={headingId}
      className="mt-8 border-t border-(--sh-line-1) pt-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id={headingId}
          className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)"
        >
          {theme.name}{" "}
          <span className="font-normal text-(--sh-text-3)">({theme.count})</span>
        </h2>
        <SubscribeControl scope={theme.slug} />
      </div>

      <ul className="mt-2">
        {first.map((event) => (
          <EventRow key={event.event_id} event={event} theme={theme} />
        ))}
      </ul>

      {rest.length > 0 ? (
        <details className="group mt-1 border-t border-(--sh-line-1)">
          <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-2 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) [&::-webkit-details-marker]:hidden">
            <svg
              viewBox="0 0 12 12"
              className="h-2.5 w-2.5 transition-transform motion-reduce:transition-none group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              aria-hidden="true"
            >
              <path d="M2.5 4.5 6 8l3.5-3.5" />
            </svg>
            Show all {events.length}
          </summary>
          <ul className="pb-1">
            {rest.map((event) => (
              <EventRow key={event.event_id} event={event} theme={theme} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export default async function UpcomingPage({
  searchParams,
}: {
  searchParams: Promise<{ themes?: string | string[] }>;
}) {
  const [params, payload] = await Promise.all([
    searchParams,
    getUpcoming().catch(() => null),
  ]);
  const selected = parseFilter(params.themes);
  const themes = orderedThemes(payload);
  const shown = selected.length
    ? themes.filter((theme) => selected.includes(theme.slug))
    : themes;
  const unavailable = !payload || Boolean(payload.message);

  return (
    <main className="relative h-full w-full overflow-y-auto overflow-x-hidden pb-24">
      <UpcomingPageTracker />
      <div className="mx-auto w-full max-w-[1600px] px-3 pt-(--sh-header-clear) sm:px-5 lg:px-8">
        <header className="max-w-2xl">
          <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
            Calendar
          </p>
          <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
            Upcoming dates
          </h1>
          <p className="mt-4 text-body leading-relaxed text-(--sh-text-2) sm:text-strong">
            Scheduled economic releases, central-bank decisions, eclipses,
            solstices and festivals for the next 12 months, from official
            calendars.
          </p>
        </header>

        {unavailable ? (
          <p className="mt-6 max-w-xl border-t border-(--sh-line-1) pt-5 text-body leading-relaxed text-(--sh-text-2)">
            Upcoming dates are unavailable right now. Please check back soon.
          </p>
        ) : (
          <>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-meta text-(--sh-text-3)">
                Times are shown in your time zone.
              </p>
              <SubscribeControl scope="all" label="Subscribe to all" />
            </div>

            <div className="mt-4 border-y border-(--sh-line-1) py-1">
              <UpcomingFilterLinks themes={themes} selected={selected} />
            </div>

            {shown.length === 0 ? (
              <p className="mt-6 text-body text-(--sh-text-2)">
                No dates match this filter.{" "}
                <Link
                  href="/upcoming"
                  className="inline-flex min-h-11 items-center underline decoration-current/30 underline-offset-2 hover:decoration-current focus-visible:decoration-current"
                >
                  Show all dates
                </Link>
              </p>
            ) : (
              shown.map((theme) => <ThemeSection key={theme.slug} theme={theme} />)
            )}

            <p className="mt-8 border-t border-(--sh-line-1) pt-4 text-micro leading-relaxed text-(--sh-text-3)">
              Natural disasters can&apos;t be scheduled, so none are listed.
            </p>
          </>
        )}
        <SiteColophon current="/upcoming" />
      </div>
    </main>
  );
}
