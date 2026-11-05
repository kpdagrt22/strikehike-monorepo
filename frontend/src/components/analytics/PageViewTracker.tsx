"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { pageViewed } from "@/lib/analytics/events";

const PATHS = new Set([
  "/",
  "/regime",
  "/convergence",
  "/patterns",
  "/disclaimer",
]);

export function PageViewTracker() {
  const pathname = usePathname();
  const first = useRef(true);
  const back = useRef(false);

  useEffect(() => {
    const onPop = () => {
      back.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    let navType: "load" | "client" | "back_forward" = "client";
    if (first.current) {
      const entry = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      navType = entry?.type === "back_forward" ? "back_forward" : "load";
      first.current = false;
    } else if (back.current) {
      navType = "back_forward";
    }
    back.current = false;
    pageViewed(PATHS.has(pathname) ? pathname : "404", navType);
  }, [pathname]);

  return null;
}
