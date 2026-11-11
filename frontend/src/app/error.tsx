"use client";

import { ErrorPanel } from "@/components/states/ErrorPanel";

export default function Error({ reset }: { reset: () => void }) {
  return <ErrorPanel reset={reset} />;
}
