"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useMounted } from "@/hooks/useMounted";
import { useChronoStore } from "@/store/chronoStore";

// The five views in nav order.
export const VIEWS = [
  { href: "/", label: "Orrery", prefetch: false },
  { href: "/regime", label: "Regime" },
  { href: "/convergence", label: "Convergence" },
  { href: "/patterns", label: "Patterns" },
  { href: "/upcoming", label: "Upcoming" },
];

// Pages outside the five views: only the menu carries these.
const PAGES = [{ href: "/disclaimer", label: "Disclaimer" }];

// The view (or page) a pathname belongs to; anything else outside the five
// views is the Orrery.
export function viewForPath(pathname) {
  // The event, theme and year pages belong to the Upcoming view.
  if (pathname?.startsWith("/events/") || pathname?.startsWith("/dates/")) {
    return VIEWS.find((view) => view.href === "/upcoming") ?? VIEWS[0];
  }
  return (
    [...VIEWS, ...PAGES].find(
      (view) =>
        view.href !== "/" &&
        (pathname === view.href || pathname?.startsWith(`${view.href}/`)),
    ) ?? VIEWS[0]
  );
}

const LAYOUT = {
  list: {
    nav: "flex flex-col gap-0.5",
    tab: "flex min-h-11 items-center gap-2.5 rounded-xl px-3.5 text-micro tracking-[0.1em]",
  },
  row: {
    nav: "flex items-center gap-0.5",
    // The five full labels share the top line with the brand and the menu.
    // Below lg they step down one size so 640 px still clears both.
    tab: "inline-flex min-h-11 items-center rounded-full px-0 text-[0.6875rem] tracking-[0.06em] lg:px-3 lg:text-micro lg:tracking-[0.1em]",
  },
  scroll: {
    nav: "flex items-center gap-1 overflow-x-auto px-3 [mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%_-_2rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
    tab: "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-micro tracking-[0.1em]",
  },
};

function tabClass(active, layout) {
  return [
    LAYOUT[layout]?.tab ?? LAYOUT.list.tab,
    "font-medium uppercase transition-colors duration-(--sh-dur-micro)",
    active
      ? "bg-(--sh-selected) text-(--sh-text-1)"
      : "text-(--sh-text-2) hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) focus-visible:text-(--sh-text-1)",
  ].join(" ");
}

export function ModeSwitch({ layout = "list", onNavigate }) {
  const pathname = usePathname();
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const mounted = useMounted();
  const current = viewForPath(pathname);
  const navRef = useRef(null);
  const dateQuery =
    mounted && focusedDate ? `?d=${encodeURIComponent(focusedDate)}` : "";

  useEffect(() => {
    if (layout !== "scroll") return;
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [layout, pathname]);

  return (
    <nav
      ref={navRef}
      aria-label="Engine views"
      className={LAYOUT[layout]?.nav ?? LAYOUT.list.nav}
    >
      {VIEWS.map((view) => {
        const active = view === current;
        return (
          <Link
            key={view.href}
            href={`${view.href}${dateQuery}`}
            prefetch={view.prefetch}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={tabClass(active, layout)}
          >
            {layout === "list" ? (
              <span
                className={`h-1 w-1 shrink-0 rounded-full ${
                  active ? "bg-current" : "bg-(--sh-text-4)"
                }`}
                aria-hidden="true"
              />
            ) : null}
            {view.label}
          </Link>
        );
      })}

      {layout === "list" ? (
        <>
          <span
            aria-hidden="true"
            className="my-1 h-px bg-(--sh-line-1)"
          />
          {PAGES.map((view) => {
            const active = view === current;
            return (
              <Link
                key={view.href}
                href={`${view.href}${dateQuery}`}
                prefetch={false}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={tabClass(active, "list")}
              >
                <span
                  className={`h-1 w-1 shrink-0 rounded-full ${
                    active ? "bg-current" : "bg-(--sh-text-4)"
                  }`}
                  aria-hidden="true"
                />
                {view.label}
              </Link>
            );
          })}
        </>
      ) : null}
    </nav>
  );
}
