import Link from "next/link";
import { ChangeNote } from "@/components/retention/ChangeNote";

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
        <Link
          href="/regime"
          className="inline-flex min-h-11 items-center rounded-full bg-(--sh-ink) px-4 text-meta font-medium text-(--sh-pearl) transition-colors hover:bg-(--sh-signal) hover:text-(--sh-ink) focus-visible:bg-(--sh-signal) focus-visible:text-(--sh-ink) dark:bg-(--sh-pearl) dark:text-(--sh-ink) dark:hover:bg-(--sh-signal-ink) dark:hover:text-(--sh-ink) dark:focus-visible:bg-(--sh-signal-ink) dark:focus-visible:text-(--sh-ink)"
        >
          See 170 years of markets beside the sky
        </Link>
        {compact ? null : (
          <Link
            href="/upcoming"
            prefetch={false}
            data-home-secondary
            className="inline-flex min-h-11 items-center text-micro font-medium text-(--sh-text-2) underline decoration-current/30 underline-offset-4 transition-colors hover:text-(--sh-text-1) hover:decoration-current focus-visible:text-(--sh-text-1) focus-visible:decoration-current"
          >
            Upcoming dates
          </Link>
        )}
      </div>
      <ChangeNote where="home" />
    </div>
  );
}
