import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { DataUnavailable } from "@/components/states/DataUnavailable";
import { ShareButton } from "@/components/reference/ShareButton";
import { UpcomingGroups } from "@/components/upcoming/UpcomingGroups";
import { UpcomingRail } from "@/components/upcoming/UpcomingRail";
import {
  flatEvents,
  nextItem,
  themeGroup,
} from "@/components/upcoming/upcomingGrouping";
import { isIndexableTheme } from "@/lib/events/indexing";
import { orderedThemes, themeName } from "@/lib/events/upcoming";
import { archiveCount, getEventsHealth, getUpcoming } from "@/lib/seo/data";
import { themePageGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

// Rendered per request, not prerendered at build: the Docker build has no backend, so a
// prerendered copy would serve "no dates" and a noindex robots tag for its revalidate window
// after every deploy. dynamicParams=false still 404s politics and natural-disasters.
export const dynamic = "force-dynamic";
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
  const unavailable = !payload || Boolean(payload.message);
  const decision = isIndexableTheme({ name, upcoming: events.length });
  const history = archiveCount(health, name);
  const path = `/upcoming/${theme}`;
  const asOf = payload?.as_of?.slice(0, 10);

  const themes = orderedThemes(payload);
  const themeEntry =
    themes.find((item) => item.slug === theme) ?? {
      name,
      slug: theme,
      data: payload?.themes?.[name] ?? { events: [] },
      count: events.length,
      available: events.length,
    };
  const items = flatEvents([themeEntry]);
  const groups = themeGroup(themeEntry, items);
  const total = themes.reduce((sum, item) => sum + item.available, 0);

  return (
    <PageShell>
      <JsonLd
        data={themePageGraph(
          path,
          TITLE[theme],
          `${INTRO[theme]}${history ? ` ${history} past events in the archive.` : ""}`,
          asOf ?? new Date().toISOString().slice(0, 10),
        )}
      />
      <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[21rem_minmax(0,1fr)]">
        <UpcomingRail
          title={TITLE[theme]}
          intro={INTRO[theme]}
          note={
            <>
              {history != null
                ? `${history} past events in the archive.`
                : "The archive count is unavailable right now."}{" "}
              <Link
                href="/upcoming"
                className="underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
              >
                All upcoming dates
              </Link>
            </>
          }
          breadcrumb={
            <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
              <Link href="/" className="hover:text-(--sh-text-1)">
                StrikeHike
              </Link>
              <span aria-hidden="true"> / </span>
              <Link href="/upcoming" className="hover:text-(--sh-text-1)">
                Upcoming dates
              </Link>
            </nav>
          }
          subscribeScope={theme}
          themes={themes}
          current={theme}
          total={total}
          next={nextItem(items)}
          showFilterSubscribes={false}
          share={
            <ShareButton
              surface="theme"
              url={urlFor(path)}
              title={TITLE[theme]}
            />
          }
        />

        <div className="mt-8 min-w-0 lg:mt-0">
          {unavailable ? (
            <DataUnavailable
              title={`${name} dates are unavailable right now.`}
              detail="The calendar service did not answer. Try again in a moment."
            />
          ) : events.length > 0 ? (
            <UpcomingGroups groups={groups} />
          ) : (
            <p className="mt-6 max-w-xl text-body leading-relaxed text-(--sh-text-2)">
              Nothing scheduled in the next 12 months for {name}.{" "}
              <Link
                href="/upcoming"
                className="underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
              >
                See all upcoming dates.
              </Link>
            </p>
          )}

          <p className="mt-8 border-t border-(--sh-line-1) pt-4 text-micro leading-relaxed text-(--sh-text-3)">
            {decision.index
              ? "This page lists dates only; StrikeHike does not say what will happen on them."
              : "This page lists dates only; it stays out of search until there are more of them."}
          </p>
        </div>
      </div>
      <SiteColophon current={path} />
    </PageShell>
  );
}
