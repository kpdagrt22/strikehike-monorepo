import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { SubscribeControl } from "@/components/upcoming/SubscribeControl";
import { UpcomingEventRow } from "@/components/upcoming/UpcomingEventRow";
import { isIndexableTheme } from "@/lib/events/indexing";
import { themeName } from "@/lib/events/upcoming";
import { archiveCount, getEventsHealth, getUpcoming } from "@/lib/seo/data";
import { themePageGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const revalidate = 300;
export const dynamicParams = false;

// Only the three themes with pages. Politics and Natural Disasters are not
// generated, and dynamicParams = false makes them 404s.
const THEMES = ["science", "finance", "culture-religion"] as const;
type VisibleTheme = (typeof THEMES)[number];

export function generateStaticParams() {
  return THEMES.map((theme) => ({ theme }));
}

const INTRO = {
  finance:
    "Scheduled US data releases and central-bank decisions, with times from the agencies' own calendars.",
  science: "Eclipses, solstices and equinoxes, computed from planetary positions.",
  "culture-religion": "Dates of major religious festivals, computed from their calendars.",
} satisfies Record<VisibleTheme, string>;

const TITLE = {
  finance: "Finance dates",
  science: "Science dates",
  "culture-religion": "Culture and religion dates",
} satisfies Record<VisibleTheme, string>;

function isTheme(value: string): value is VisibleTheme {
  return (THEMES as readonly string[]).includes(value);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ theme: string }>;
}): Promise<Metadata> {
  const { theme } = await params;
  if (!isTheme(theme)) return { title: "Not found", robots: { index: false, follow: true } };
  const name = themeName(theme) ?? TITLE[theme];
  const payload = await getUpcoming().catch(() => null);
  const count = payload?.themes?.[name]?.events?.length ?? 0;
  const decision = isIndexableTheme({ name, upcoming: count });
  const description = `${INTRO[theme]} ${
    count > 0 ? `${count} dates ahead.` : "Dates ahead."
  } Times are shown in your time zone; subscribe in your calendar.`;
  const title = `${TITLE[theme]} · ${SITE_NAME}`;
  const path = `/upcoming/${theme}`;
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

export default async function ThemePage({
  params,
}: {
  params: Promise<{ theme: string }>;
}) {
  const { theme } = await params;
  if (!isTheme(theme)) notFound();
  const name = themeName(theme) ?? TITLE[theme];
  const [payload, health] = await Promise.all([
    getUpcoming().catch(() => null),
    getEventsHealth().catch(() => null),
  ]);
  const events = payload?.themes?.[name]?.events ?? [];
  const decision = isIndexableTheme({ name, upcoming: events.length });
  const history = archiveCount(health, name);
  const path = `/upcoming/${theme}`;
  const asOf = payload?.as_of?.slice(0, 10);

  return (
    <main className="relative h-full w-full overflow-y-auto overflow-x-hidden pb-24">
      <JsonLd
        data={themePageGraph(
          path,
          TITLE[theme],
          `${INTRO[theme]}${history ? ` ${history} past events in the archive.` : ""}`,
          asOf ?? new Date().toISOString().slice(0, 10),
        )}
      />
      <div className="w-full max-w-3xl px-3 pt-(--sh-header-clear) sm:px-5 lg:px-8">
        <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
          <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
          <span aria-hidden="true"> / </span>
          <Link href="/upcoming" className="hover:text-(--sh-text-1)">Upcoming dates</Link>
        </nav>

        <header className="mt-4">
          <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">Calendar</p>
          <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
            {TITLE[theme]}
          </h1>
          <p className="mt-4 max-w-2xl text-body leading-relaxed text-(--sh-text-2) sm:text-strong">
            {INTRO[theme]}
          </p>
          <p className="mt-2 text-meta text-(--sh-text-3)">
            {history != null
              ? `${history} past events in the archive.`
              : "The archive count is unavailable right now."}{" "}
            <Link
              href="/upcoming"
              className="underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
            >
              All upcoming dates
            </Link>
          </p>
        </header>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-y border-(--sh-line-1) py-2">
          <p className="text-meta text-(--sh-text-3)">
            {events.length > 0
              ? `${events.length} ${events.length === 1 ? "date" : "dates"} in the next 12 months.`
              : "No dates in the next 12 months."}{" "}
            Times are shown in your time zone.
          </p>
          <SubscribeControl scope={theme} />
        </div>

        {events.length > 0 ? (
          <ul className="mt-2">
            {events.map((event) => (
              <UpcomingEventRow
                key={event.event_id}
                event={event}
                themeSlug={theme}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-6 text-body text-(--sh-text-2)">
            No {name} dates are scheduled in the next 12 months.
          </p>
        )}

        <p className="mt-8 border-t border-(--sh-line-1) pt-4 text-micro leading-relaxed text-(--sh-text-3)">
          {decision.index
            ? "This page lists dates only; StrikeHike does not say what will happen on them."
            : "This page lists dates only; it stays out of search until there are more of them."}
        </p>

        <SiteColophon current={path} />
      </div>
    </main>
  );
}
