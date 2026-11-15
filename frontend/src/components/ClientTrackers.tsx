"use client";

import dynamic from "next/dynamic";
import { EventActionTracker } from "@/components/upcoming/EventActionTracker";

// The local-time rewrite can arrive after hydration: it only changes text that
// is already on screen. The action tracker must be listening before the first
// click, so it stays in the eager chunk.
const LocalTimeSync = dynamic(
  () =>
    import("@/components/upcoming/LocalTimeSync").then(
      (mod) => mod.LocalTimeSync,
    ),
  { ssr: false },
);

export function ClientTrackers() {
  return (
    <>
      <LocalTimeSync />
      <EventActionTracker />
    </>
  );
}
