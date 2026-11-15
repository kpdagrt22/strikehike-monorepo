"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  allDayLabel,
  allDayLongLabel,
  dateLabel,
  eventInstant,
  longDateLabel,
  timeLabel,
  zoneLabel,
} from "@/lib/events/localTime";

// One pass over every [data-ld] node turns the server's UTC text into the
// reader's zone. The rows stay server components, so /upcoming and /this-week
// hydrate one island instead of one per date. The observer repeats the pass when
// a deferred section or a client list mounts; writes only happen when the text
// differs.
function update(root: ParentNode) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  for (const node of root.querySelectorAll<HTMLElement>("[data-ld]")) {
    const startDate = node.dataset.sd;
    if (!startDate) continue;
    const startUtc = node.dataset.su || null;
    const startTime = node.dataset.st || null;
    const allDay = node.dataset.ad != null;
    const long = node.dataset.lg != null;
    const part = node.dataset.ld;

    let text: string;
    if (allDay) {
      text =
        part === "date"
          ? long
            ? allDayLongLabel(startDate)
            : allDayLabel(startDate)
          : "All day";
    } else {
      const instant = eventInstant(startDate, startTime, startUtc);
      text =
        part === "date"
          ? long
            ? longDateLabel(instant, zone)
            : dateLabel(instant, zone)
          : `${timeLabel(instant, zone)} ${zoneLabel(instant, zone)}`;
    }
    if (node.textContent !== text) node.textContent = text;
  }
}

export function LocalTimeSync() {
  const pathname = usePathname();

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update(document);
      });
    };

    const queued = window.setTimeout(schedule, 0);
    // Only new nodes (a deferred section or a client list mounting). A text
    // rewrite from a client card is that card's own concern; NextUpCard uses
    // LocalTime so its minute tick keeps local time.
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(queued);
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
