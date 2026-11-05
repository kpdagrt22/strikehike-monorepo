"use client";

import { useEffect } from "react";
import { upcomingOpened } from "@/lib/analytics/events";

export function UpcomingPageTracker() {
  useEffect(() => {
    upcomingOpened("page");
  }, []);
  return null;
}
