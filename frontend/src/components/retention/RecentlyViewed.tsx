"use client";

import Link from "next/link";
import { useRecent } from "@/hooks/useRetention";
import {
  clearRecent,
  recentHref,
  recentKindLabel,
} from "@/lib/retention/storage";

// A compact list of the last pages opened. Hidden until there is something to
// show, so the server HTML has no empty section.
export function RecentlyViewed({
  className = "",
  heading = "Recently viewed",
}: {
  className?: string;
  heading?: string;
}) {
  const recent = useRecent();
  if (recent.length === 0) return null;

  return (
    <section
      data-recently-viewed=""
      aria-labelledby="recently-viewed-heading"
      className={`mt-5 rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-3 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="recently-viewed-heading"
          className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)"
        >
          {heading}
        </h2>
        <button
          type="button"
          data-clear-recent=""
          onClick={() => clearRecent()}
          className="inline-flex min-h-9 items-center rounded-full px-2 text-micro font-medium text-(--sh-text-2) underline decoration-current/30 underline-offset-2 transition-colors hover:text-(--sh-text-1) hover:decoration-current focus-visible:text-(--sh-text-1) focus-visible:decoration-current pointer-coarse:min-h-11"
        >
          Clear
        </button>
      </div>
      <ul className="mt-1.5 space-y-1">
        {recent.map((item) => (
          <li key={`${item.kind}:${item.id}`} className="flex min-w-0 items-baseline gap-2">
            <span className="w-16 shrink-0 text-micro uppercase tracking-[0.08em] text-(--sh-text-3)">
              {recentKindLabel(item.kind)}
            </span>
            <Link
              href={recentHref(item)}
              className="min-w-0 truncate text-meta text-(--sh-text-1) underline decoration-transparent underline-offset-2 hover:decoration-current focus-visible:decoration-current"
              title={item.title}
            >
              {item.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
