import Link from "next/link";
import { PERSON_URL, REPO_URL } from "@/lib/seo/site";
import { DigestFooterLink } from "@/components/digest/DigestFooterLink";
import { FooterSupportLink } from "@/components/support/FooterSupportLink";
import {
  SUPPORT_NOTE,
  SUPPORT_PAYS,
  SUPPORT_TITLE,
  SUPPORT_WHAT,
} from "@/lib/support/copy";
import { LINK } from "./styles";

const VIEWS: { href: string; label: string }[] = [
  { href: "/", label: "Orrery" },
  { href: "/regime", label: "Regime" },
  { href: "/recessions", label: "Recessions" },
  { href: "/declines", label: "20% falls" },
  { href: "/convergence", label: "Convergence" },
  { href: "/patterns", label: "Study of Patterns" },
  { href: "/upcoming", label: "Upcoming dates" },
  { href: "/this-week", label: "This week" },
  { href: "/ledger", label: "Ledger" },
  { href: "/tested", label: "Tested" },
  { href: "/disclaimer", label: "Disclaimer" },
  { href: "/about", label: "About" },
];

/**
 * The quiet row at the foot of each scrolling page (/regime, /convergence, /patterns,
 * /disclaimer): the views as plain links, and who builds the site. A Server Component, so the
 * links and the credit are in the HTML every crawler reads. Not on the full-bleed home page,
 * whose About panel carries the same links.
 *
 * Below that, a quiet "Support StrikeHike" block. It is the same words the home panel shows
 * (owner approves the final text; decision D-14) and the only support link here, so the footer
 * link reports both support events with surface "footer".
 */
function WeeklyPromo() {
  return (
    <aside
      aria-label="The weekly roundup"
      data-weekly-promo
      className="flex flex-col gap-3 rounded-2xl border border-(--sh-weekly-line) bg-(--sh-weekly-soft) p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium uppercase tracking-[0.18em] text-(--sh-weekly)">
          <span className="sh-weekly-dot" aria-hidden="true" />
          Weekly roundup
        </p>
        <p className="mt-1.5 text-meta leading-snug text-(--sh-text-1)">
          The Regime reading, the dates ahead and the sky, in one short note
          each week.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <Link
          href="/this-week"
          prefetch={false}
          data-weekly-promo-link
          className="inline-flex min-h-10 items-center rounded-full bg-(--sh-weekly-fill) px-4 text-micro font-semibold text-(--sh-weekly-on-fill) transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--sh-weekly)"
        >
          Read this week&apos;s roundup
        </Link>
        <DigestFooterLink className={LINK} />
      </div>
    </aside>
  );
}

export function SiteColophon({
  current,
  compact = false,
}: {
  current: string;
  compact?: boolean;
}) {
  return (
    <footer
      className={
        compact
          ? "mt-4 flex flex-col gap-2 border-t border-black/5 pt-3 text-micro text-black/60 dark:border-white/5 dark:text-white/60"
          : "mt-10 flex flex-col gap-3 border-t border-black/5 pt-4 text-micro text-black/60 dark:border-white/5 dark:text-white/60"
      }
    >
      {/* The roundup pages carry their own weekly column. */}
      {!compact && current !== "/this-week" ? <WeeklyPromo /> : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="StrikeHike pages" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {VIEWS.map((view) =>
            view.href === current ? (
              <span key={view.href} aria-current="page">
                {view.label}
              </span>
            ) : (
              <Link key={view.href} href={view.href} prefetch={false} className={LINK}>
                {view.label}
              </Link>
            ),
          )}
        </nav>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Built and run by{" "}
            <a href={PERSON_URL} rel="author" className={LINK}>
              Prakash Kantumutchu (KP)
            </a>
          </span>
          <a href={REPO_URL} className={LINK}>
            Source on GitHub
          </a>
        </p>
      </div>

      {compact ? (
        <p>
          <FooterSupportLink className={LINK}>Support StrikeHike</FooterSupportLink>
          . {SUPPORT_NOTE}
        </p>
      ) : (
        <section
          aria-label={SUPPORT_TITLE}
          data-support-block
          className="flex flex-col gap-1 border-t border-black/5 pt-3 dark:border-white/5"
        >
          <p className="font-medium uppercase tracking-[0.14em]">{SUPPORT_TITLE}</p>
          <p className="max-w-prose break-words">{SUPPORT_WHAT}</p>
          <p className="max-w-prose break-words">
            {SUPPORT_PAYS}{" "}
            <FooterSupportLink className={LINK}>Support via PayPal</FooterSupportLink>
          </p>
          <p>{SUPPORT_NOTE}</p>
        </section>
      )}
    </footer>
  );
}
