"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChronoStore } from "@/store/chronoStore";

// The four engine views in nav order; "short" is the label where room is
// short (the phone cue, the header's row below lg).
const VIEWS = [
  { href: "/", label: "Orrery", prefetch: false },
  { href: "/regime", label: "Regime" },
  { href: "/convergence", label: "Convergence", short: "Conv." },
  { href: "/patterns", label: "Study of Patterns", short: "Patterns" },
];

// The view a pathname belongs to; anything outside the three data views is
// the Orrery.
export function viewForPath(pathname) {
  return (
    VIEWS.find(
      (view) =>
        view.href !== "/" &&
        (pathname === view.href || pathname?.startsWith(`${view.href}/`)),
    ) ?? VIEWS[0]
  );
}

// The header's views: a short list of 44 px rows under the cue, or one row
// in the top line (a mouse with room beside the brand). The header's panel
// draws the glass and owns the pointer events.
const LAYOUT = {
  list: {
    nav: "flex flex-col gap-0.5",
    tab: "flex h-11 items-center gap-2.5 rounded-xl px-3.5",
  },
  row: {
    nav: "flex items-center",
    tab: "inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 lg:px-3",
  },
};

function tabClass(active, layout) {
  return [
    layout.tab,
    "text-micro font-medium uppercase tracking-[0.1em] transition-colors duration-(--sh-dur-micro)",
    active
      ? "bg-[#f05d49]/15 text-[#c0442f] dark:bg-[#f05d49]/20 dark:text-[#ff8b77]"
      : "text-black/60 hover:bg-black/[0.04] hover:text-black/80 focus-visible:bg-black/[0.04] focus-visible:text-black/80 dark:text-white/60 dark:hover:bg-white/[0.06] dark:hover:text-white/80 dark:focus-visible:bg-white/[0.06] dark:focus-visible:text-white/80",
  ].join(" ");
}

export function ModeSwitch({ layout = "list", onNavigate }) {
  const pathname = usePathname();
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const current = viewForPath(pathname);
  const row = layout === "row";
  const classes = LAYOUT[layout] ?? LAYOUT.list;
  const dateQuery = focusedDate ? `?d=${encodeURIComponent(focusedDate)}` : "";

  return (
    <nav aria-label="Engine views" className={classes.nav}>
      {VIEWS.map((view) => {
        const active = view === current;
        return (
          <Link
            key={view.href}
            href={`${view.href}${dateQuery}`}
            prefetch={view.prefetch}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={tabClass(active, classes)}
          >
            <span
              className={`h-1 w-1 shrink-0 rounded-full ${
                active ? "bg-current" : "bg-black/20 dark:bg-white/20"
              }`}
              aria-hidden="true"
            />
            {/* The row shows the short label until lg; the full one stays
                the link's name. */}
            {row && view.short ? (
              <>
                <span aria-hidden="true" className="lg:hidden">
                  {view.short}
                </span>
                <span className="sr-only lg:not-sr-only">{view.label}</span>
              </>
            ) : (
              view.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}
