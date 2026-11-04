"use client";

import { useEffect } from "react";
import { viewOpened } from "@/lib/analytics/events";

export function DetailsTracker({
  id,
  panel,
}: {
  id: string;
  panel: "nber_table" | "catalogue_table";
}) {
  useEffect(() => {
    const element = document.getElementById(id);
    if (!element) return undefined;
    const onToggle = () => {
      if ((element as HTMLDetailsElement).open) viewOpened(panel, "click");
    };
    element.addEventListener("toggle", onToggle);
    return () => element.removeEventListener("toggle", onToggle);
  }, [id, panel]);
  return null;
}
