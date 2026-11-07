import Link from "next/link";
import { PERSON_URL, REPO_URL, type SitePath } from "@/lib/seo/site";
import { LINK } from "./styles";

const VIEWS: { href: SitePath; label: string }[] = [
  { href: "/", label: "Orrery" },
  { href: "/regime", label: "Regime" },
  { href: "/convergence", label: "Convergence" },
  { href: "/patterns", label: "Study of Patterns" },
  { href: "/upcoming", label: "Upcoming dates" },
  { href: "/disclaimer", label: "Disclaimer" },
];

/**
 * The quiet row at the foot of each scrolling page (/regime, /convergence, /patterns,
 * /disclaimer): the views as plain links, and who builds the site. A Server Component, so the
 * links and the credit are in the HTML every crawler reads. Not on the full-bleed home page,
 * whose About panel carries the same links.
 */
export function SiteColophon({ current }: { current: string }) {
  return (
    <footer className="mt-10 flex flex-col gap-2 border-t border-black/5 pt-4 text-micro text-black/60 dark:border-white/5 dark:text-white/60 sm:flex-row sm:items-center sm:justify-between">
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
    </footer>
  );
}
