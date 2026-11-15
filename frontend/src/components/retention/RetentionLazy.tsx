"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { YourTheme } from "@/components/retention/YourThemes";

// The retention blocks render nothing before hydration (they read localStorage
// after mount). The chunk is only requested when the browser is idle, so it is
// not part of the route's first script set.
const Retention = dynamic(
  () =>
    import("@/components/retention/RetentionIslands").then(
      (mod) => mod.Retention,
    ),
  { ssr: false },
);

function useIdle() {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => setIdle(true), {
        timeout: 1_000,
      });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(() => setIdle(true), 200);
    return () => window.clearTimeout(id);
  }, []);
  return idle;
}

export function ChangeNoteLazy({ where }: { where: "home" | "upcoming" }) {
  const idle = useIdle();
  return idle ? <Retention slot="change" where={where} /> : null;
}

export function RecentlyViewedLazy({ className }: { className?: string }) {
  const idle = useIdle();
  return idle ? <Retention slot="recent" className={className} /> : null;
}

export function YourThemesLazy({ themes }: { themes: YourTheme[] }) {
  const idle = useIdle();
  return idle ? <Retention slot="themes" themes={themes} /> : null;
}
