import type { ReactNode } from "react";
import Link from "next/link";
import { NextUpCard } from "@/components/upcoming/NextUpCard";
import { SubscribeControl } from "@/components/upcoming/SubscribeControl";
import { UpcomingFilterLinks } from "@/components/upcoming/UpcomingFilterLinks";
import type { OrderedTheme } from "@/lib/events/upcoming";
import type { UpcomingEventPayload } from "@/lib/seo/data";

type Item = { event: UpcomingEventPayload; theme: OrderedTheme };

type Props = {
  eyebrow?: string;
  title: string;
  intro: string;
  note?: ReactNode;
  subscribeScope?: string;
  subscribeLabel?: string;
  themes?: OrderedTheme[];
  current?: string;
  total?: number;
  next?: Item | null;
  breadcrumb?: ReactNode;
  showFilterSubscribes?: boolean;
};

/**
 * The left rail of /upcoming and /upcoming/[theme]: what the page is, how to
 * subscribe, the theme filter with counts, and the next dated item. Sticky
 * under the site header from lg, where the list sits beside it.
 */
export function UpcomingRail({
  eyebrow = "Calendar",
  title,
  intro,
  note = null,
  subscribeScope = "all",
  subscribeLabel = "Subscribe",
  themes = [],
  current = "all",
  total = 0,
  next = null,
  breadcrumb = null,
  showFilterSubscribes = true,
}: Props) {
  return (
    <aside className="min-w-0 lg:sticky lg:top-(--sh-header-clear) lg:max-h-[calc(100dvh-var(--sh-header-clear)-1.5rem)] lg:self-start lg:overflow-y-auto lg:pr-2 lg:[scrollbar-width:thin]">
      {breadcrumb}
      <header className={breadcrumb ? "mt-4" : ""}>
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-[2.5rem]">
          {title}
        </h1>
        <p className="mt-3 max-w-2xl text-body leading-relaxed text-(--sh-text-2)">
          {intro}
        </p>
        {note ? (
          <p className="mt-2 text-meta leading-relaxed text-(--sh-text-3)">
            {note}
          </p>
        ) : null}
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-meta text-(--sh-text-3)">
          Times are shown in your time zone.
        </p>
        <SubscribeControl scope={subscribeScope} label={subscribeLabel} />
      </div>

      <div className="mt-5 border-t border-(--sh-line-1) pt-2">
        <p className="hidden px-2 text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3) lg:block">
          Themes
        </p>
        <div className="lg:hidden">
          <UpcomingFilterLinks
            themes={themes}
            current={current}
            total={total}
            compact
          />
        </div>
        <div className="hidden lg:block">
          <UpcomingFilterLinks
            themes={themes}
            current={current}
            total={total}
            showSubscribes={showFilterSubscribes}
          />
        </div>
      </div>

      <div className="hidden lg:block">
        <NextUpCard item={next} />
      </div>

      {subscribeScope === "all" ? (
        <p className="mt-4 text-micro leading-relaxed text-(--sh-text-3)">
          Natural disasters can&apos;t be scheduled, so none are listed.{" "}
          <Link
            href="/calendar/all.ics"
            className="underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
          >
            All dates in one feed
          </Link>
          .
        </p>
      ) : null}
    </aside>
  );
}
