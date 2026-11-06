"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { pageViewed } from "@/lib/analytics/events";
import { pageTemplate } from "@/lib/analytics/paths";

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
    // A template, never the raw path: /events/… ids and unknown pages are
    // recorded as "/events/[id]" and "404".
    pageViewed(pageTemplate(pathname), navType);
  }, [pathname]);

  return null;
}
