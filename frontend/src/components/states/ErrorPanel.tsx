"use client";

import Link from "next/link";

/** Shared error boundary panel: one sentence, Retry, home. No stack traces. */
export function ErrorPanel({ reset }: { reset: () => void }) {
  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden px-4">
      <div className="w-full max-w-lg rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-6 text-center">
        <p className="text-micro uppercase tracking-[0.18em] text-(--sh-signal-ink)">
          Something went wrong
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-(--sh-text-1)">
          This page could not be loaded.
        </h1>
        <p className="mt-2 text-meta leading-relaxed text-(--sh-text-2)">
          Please try again; nothing was changed.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            data-error-retry=""
            onClick={() => reset()}
            className="inline-flex min-h-10 items-center rounded-full border border-(--sh-line-2) px-4 text-micro font-medium text-(--sh-text-1) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) pointer-coarse:min-h-11"
          >
            Retry
          </button>
          <Link
            href="/"
            className="text-micro font-medium text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
