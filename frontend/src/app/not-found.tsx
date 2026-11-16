import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { RecentlyViewedLazy } from "@/components/retention/RetentionLazy";

// Out of the index, links still followed. The root layout sets no canonical or hreflang, so the
// 404 claims no URL of its own. This tree is serialised into every page's RSC payload (as the
// not-found boundary), so its long class lists live in globals.css (.sh-404, .sh-404-view; S3.2).
export const metadata: Metadata = {
  title: "Off the timeline",
  robots: { index: false, follow: true },
};

const VIEWS = [
  { href: "/", label: "Orrery" },
  { href: "/regime", label: "Regime" },
  { href: "/convergence", label: "Convergence" },
  { href: "/patterns", label: "Study of Patterns" },
  { href: "/upcoming", label: "Upcoming dates" },
];

export default function NotFound() {
  return (
    <main className="sh-404">
      <div className="flex max-w-xl flex-col items-center text-center">
        <Image
          src="/icon.png"
          alt=""
          width={48}
          height={48}
          aria-hidden="true"
          draggable={false}
          className="h-12 w-12 rounded-full object-cover ring-1 ring-black/10 dark:ring-white/10"
        />
        <h1 className="mt-6 text-[32px] font-light leading-[1.1] tracking-[-0.04em] text-[#14121a] sm:text-[44px] dark:text-[#f2ede4]">
          Off the timeline.
        </h1>
        <p className="mt-3 text-body leading-relaxed text-black/70 dark:text-white/70">
          This address isn&apos;t part of the engine.
        </p>
        <nav
          aria-label="Engine views"
          className="mt-8 grid w-full max-w-64 gap-2 sm:flex sm:w-auto sm:max-w-none sm:justify-center"
        >
          {VIEWS.map((view) => (
            <Link
              key={view.href}
              href={view.href}
              prefetch={false}
              className="sh-404-view"
            >
              {view.label}
            </Link>
          ))}
        </nav>
        <RecentlyViewedLazy className="w-full text-left" />
      </div>
    </main>
  );
}
