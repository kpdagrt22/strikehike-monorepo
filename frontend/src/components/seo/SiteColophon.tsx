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
export function SiteColophon({ current }: { current: string }) {
  return (
    <footer className="mt-10 flex flex-col gap-3 border-t border-black/5 pt-4 text-micro text-black/60 dark:border-white/5 dark:text-white/60">
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

      <p>
        <DigestFooterLink className={LINK} />
      </p>

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
    </footer>
  );
}
