import Link from "next/link";
import { RetryButton } from "@/components/states/RetryButton";

/** The shared "data could not be read" panel. No raw error text. */
export function DataUnavailable({
  title = "This page is unavailable right now.",
  detail = "The archive did not answer. Try again in a moment.",
}) {
  return (
    <section
      data-data-unavailable=""
      className="mt-8 max-w-xl rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-5"
    >
      <h2 className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
        {title}
      </h2>
      <p className="mt-2 text-meta leading-relaxed text-(--sh-text-2)">
        {detail}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <RetryButton />
        <Link
          href="/"
          className="text-micro font-medium text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
        >
          Go home
        </Link>
      </div>
    </section>
  );
}
