"use client";

import Link from "next/link";
import { useExperiment } from "@/lib/experiments/useExperiment";

// The home call to action labelled by the "home-cta" experiment. The server and
// the first client paint both show the control label; an effect swaps only the
// text node, so the link, its classes and the pill's size never change.
const LABELS: Record<string, string> = {
  control: "See 170 years of markets beside the sky",
  record: "Explore the market record",
};

export function HomeCta() {
  const { variant } = useExperiment("home-cta");
  return (
    <Link
      href="/regime"
      data-home-cta
      data-exp-variant={variant}
      className="inline-flex min-h-11 items-center rounded-full bg-(--sh-ink) px-4 text-meta font-medium text-(--sh-pearl) transition-colors hover:bg-(--sh-signal) hover:text-(--sh-ink) focus-visible:bg-(--sh-signal) focus-visible:text-(--sh-ink) dark:bg-(--sh-pearl) dark:text-(--sh-ink) dark:hover:bg-(--sh-signal-ink) dark:hover:text-(--sh-ink) dark:focus-visible:bg-(--sh-signal-ink) dark:focus-visible:text-(--sh-ink)"
    >
      {LABELS[variant] ?? LABELS.control}
    </Link>
  );
}
