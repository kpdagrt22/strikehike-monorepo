import Link from "next/link";
import { ChangeNote } from "@/components/retention/ChangeNote";
import { HomeCta } from "@/components/experiments/HomeCta";

// Server-rendered first paint: the H1 and both actions are in the HTML before
// the orrery's JavaScript. It sits left of the centred gauge on desktop and
// above it on phones.
export function HomeIntro({ compact = false }) {
  return (
    <div
      data-home-intro
      data-compact={compact ? "true" : undefined}
      className="pointer-events-none absolute left-3 top-[calc(var(--sh-header-clear)+0.5rem)] z-20 w-[calc(100vw-1.5rem)] sm:left-5 sm:w-[18rem] xl:w-[24rem]"
    >
      <h1
        className={
          compact
            ? "text-[1.25rem] font-semibold leading-[1.05] tracking-[-0.04em] text-(--sh-text-1)"
            : "text-[1.75rem] font-semibold leading-[1.04] tracking-[-0.045em] text-(--sh-text-1) xl:text-[2rem]"
        }
      >
        The market record beside the sky, tested in public.
      </h1>
      {compact ? null : (
        <p
          data-home-promise
          className="mt-2 text-meta leading-relaxed text-(--sh-text-2) sm:text-body"
        >
          170 years of US recessions and market declines set against the planets,
          with every hit and miss shown.
        </p>
      )}
      <div
        className={`pointer-events-auto flex flex-col items-start gap-1.5 ${
          compact ? "mt-2" : "mt-3"
        }`}
      >
        <HomeCta />
        {compact ? null : (
          <div className="flex flex-wrap items-center gap-x-5">
            {/* The weekly roundup gets the gold mark wherever it is offered. */}
            <Link
              href="/this-week"
              prefetch={false}
              data-home-weekly
              className="inline-flex min-h-11 items-center gap-2 text-micro font-medium text-(--sh-weekly) underline decoration-current/30 underline-offset-4 transition-colors hover:decoration-current focus-visible:decoration-current"
            >
              <span className="sh-weekly-dot" aria-hidden="true" />
              This week&apos;s roundup
            </Link>
            <Link
              href="/upcoming"
              prefetch={false}
              data-home-secondary
              className="inline-flex min-h-11 items-center text-micro font-medium text-(--sh-text-2) underline decoration-current/30 underline-offset-4 transition-colors hover:text-(--sh-text-1) hover:decoration-current focus-visible:text-(--sh-text-1) focus-visible:decoration-current"
            >
              Upcoming dates
            </Link>
          </div>
        )}
      </div>
      <ChangeNote where="home" />
    </div>
  );
}
