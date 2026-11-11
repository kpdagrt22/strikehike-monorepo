"use client";

import { useEffect } from "react";
import { addRecent, type RecentKind } from "@/lib/retention/storage";

// Mounted on a detail page: records the page once, with no query string and no
// URL, so the Recently viewed list can rebuild the link from kind and id.
export function RecentTracker({
  kind,
  id,
  title,
}: {
  kind: RecentKind;
  id: string;
  title: string;
}) {
  useEffect(() => {
    addRecent({ kind, id, title, at: Date.now() });
  }, [kind, id, title]);
  return null;
}
