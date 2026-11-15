"use client";

import { useEffect } from "react";
import {
  calendarSubscribed,
  dateTravelled,
  eventSourceClicked,
} from "@/lib/analytics/events";
import { useChronoStore } from "@/store/chronoStore";

// One listener for every dated row on the page: the rows themselves are server
// components, so this keeps the analytics without hydrating each row.
export function EventActionTracker() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLElement>("[data-event-action]");
      if (!link) return;
      if (link.dataset.eventAction === "sky" && link.dataset.eventDate) {
        dateTravelled("archive_event", link.dataset.eventDate);
        useChronoStore.getState().setFocusedDate(link.dataset.eventDate);
      }
      if (link.dataset.eventAction === "calendar" && link.dataset.calendarScope) {
        const scope = link.dataset.calendarScope;
        if (
          scope === "all" ||
          scope === "science" ||
          scope === "finance" ||
          scope === "culture-religion"
        ) {
          calendarSubscribed(scope, "download");
        }
      }
      if (link.dataset.eventAction === "source" && link.dataset.eventSource) {
        const theme = link.dataset.eventTheme;
        if (
          theme === "politics" ||
          theme === "science" ||
          theme === "finance" ||
          theme === "culture-religion" ||
          theme === "natural-disasters"
        ) {
          eventSourceClicked(
            link.dataset.eventId ?? "",
            theme,
            link.dataset.eventDays ? Number(link.dataset.eventDays) : undefined,
            link.dataset.eventSource,
          );
        }
      }
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);

  return null;
}
