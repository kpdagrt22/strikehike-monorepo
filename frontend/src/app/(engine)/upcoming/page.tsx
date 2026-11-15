import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { DataUnavailable } from "@/components/states/DataUnavailable";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { ChangeNote } from "@/components/retention/ChangeNote";
import { RecentlyViewed } from "@/components/retention/RecentlyViewed";
import { YourThemes } from "@/components/retention/YourThemes";
import { UpcomingGroups } from "@/components/upcoming/UpcomingGroups";
import { UpcomingPageTracker } from "@/components/upcoming/UpcomingPageTracker";
import { UpcomingRail } from "@/components/upcoming/UpcomingRail";
import { flatEvents, monthGroups, nextItem } from "@/components/upcoming/upcomingGrouping";
import { orderedThemes } from "@/lib/events/upcoming";
import { getUpcoming } from "@/lib/seo/data";
import { upcomingGraph } from "@/lib/seo/graphs";
import { absoluteUrl, SITE_NAME } from "@/lib/seo/site";

// Rendered per request, not prerendered at build: the Docker build has no backend, so a
// prerendered copy would serve "unavailable" (or no dates) for its revalidate window after
// every deploy. The data reads themselves keep a 60-second cache.
export const dynamic = "force-dynamic";

const TITLE = "Upcoming dates — StrikeHike";
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

const INTRO =
  "Scheduled releases, central-bank decisions, eclipses and festivals for the next 12 months, from official calendars.";

export default async function UpcomingPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const [payload, params] = await Promise.all([
    getUpcoming().catch(() => null),
    searchParams,
  ]);
  const expanded = params.all === "1";
  const themes = orderedThemes(payload);
  const unavailable = !payload || Boolean(payload.message);
  const items = flatEvents(themes);
  const groups = monthGroups(items);
  // A rolling window, not "the first calendar month": late in a month that
  // could be one or two dates. The first ten dates are the next 30 days in
  // practice, and "Show all" carries the rest.
  const asOf = payload?.as_of ? Date.parse(`${payload.as_of}T00:00:00Z`) : NaN;
  const cutoff = Number.isFinite(asOf)
    ? new Date(asOf + 30 * 86_400_000).toISOString().slice(0, 10)
    : null;
  const inWindow = cutoff
    ? items.filter(
        ({ event }: { event: { start_date: string } }) =>
          event.start_date <= cutoff,
      )
    : [];
  const defaultItems =
    inWindow.length >= 10 ? inWindow.slice(0, 10) : items.slice(0, 10);
  const shownItems = expanded ? items : defaultItems;
  const shownGroups = monthGroups(shownItems);
  const hasMore = items.length > defaultItems.length;
  const total = themes.reduce((sum, theme) => sum + theme.available, 0);
  const next = nextItem(items);
  const listedCount = items.length;
  const yourThemes = themes.map((theme) => ({
    id: theme.slug,
    name: theme.name,
    count: theme.available,
    next: (theme.data.events ?? []).slice(0, 3).map((event) => ({
      id: event.event_id,
      name: event.name,
      date: event.start_date,
    })),
  }));

  return (
    <PageShell data-upcoming-count={listedCount > 0 ? listedCount : undefined}>
      <JsonLd
        data={upcomingGraph(
          payload,
          themes.map((theme) => ({
            name: theme.name,
            slug: theme.slug,
            count: theme.available,
          })),
        )}
      />
      <UpcomingPageTracker />
      <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[21rem_minmax(0,1fr)]">
        <UpcomingRail
          title="Upcoming dates"
          intro={INTRO}
          subscribeScope="all"
          subscribeLabel="Subscribe to all"
          themes={themes.map(({ name, slug, available }) => ({
            name,
            slug,
            available,
          }))}
          current="all"
          total={total}
          next={
            next
              ? {
                  event: next.event,
                  theme: { name: next.theme.name, slug: next.theme.slug },
                }
              : null
          }
          changeNote={<ChangeNote where="upcoming" />}
          footer={<RecentlyViewed />}
        />

        <div className="mt-8 min-w-0 lg:mt-0">
          <div data-your-themes-slot="" className="mb-6">
            <YourThemes themes={yourThemes} />
          </div>
          {unavailable ? (
            <DataUnavailable
              title="Upcoming dates are unavailable right now."
              detail="The calendar service did not answer. Try again in a moment."
            />
          ) : groups.length === 0 ? (
            <p className="mt-6 text-body text-(--sh-text-2)">
              No dates are scheduled in the next 12 months.{" "}
              <Link
                href="/upcoming"
                className="inline-flex min-h-11 items-center underline decoration-current/30 underline-offset-2 hover:decoration-current focus-visible:decoration-current"
              >
                Check again
              </Link>
            </p>
          ) : (
            <>
              <UpcomingGroups groups={shownGroups} />
              {hasMore && !expanded ? (
                <p className="mt-6">
                  <Link
                    href="/upcoming?all=1"
                    className="inline-flex min-h-11 items-center rounded-full border border-(--sh-line-2) px-4 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
                  >
                    Show all {items.length} dates
                  </Link>
                </p>
              ) : expanded && hasMore ? (
                <p className="mt-6">
                  <Link
                    href="/upcoming"
                    className="inline-flex min-h-11 items-center rounded-full border border-(--sh-line-2) px-4 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
                  >
                    Show fewer dates
                  </Link>
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
      <SiteColophon current="/upcoming" />
    </PageShell>
  );
}
