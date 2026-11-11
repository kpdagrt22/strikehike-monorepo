"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RetryButton({ label = "Retry" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      data-retry=""
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-2) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) disabled:opacity-60 pointer-coarse:min-h-11"
    >
      {pending ? "Retrying…" : label}
    </button>
  );
}
