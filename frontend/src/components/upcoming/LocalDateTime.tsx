"use client";

import { useEffect, useState } from "react";
import {
  allDayLabel,
  allDayLongLabel,
  dateLabel,
  eventInstant,
  longDateLabel,
  timeLabel,
  zoneLabel,
} from "@/lib/events/localTime";

type Props = {
  startDate: string;
  startTime: string | null;
  startUtc: string | null;
  timezone: string | null;
  allDay: boolean;
  part: "date" | "time";
  /** Show the year: for pages that stand alone, such as an event page. */
  long?: boolean;
};

function serverDate({
  startDate,
  startUtc,
  allDay,
  long,
}: Pick<Props, "startDate" | "startUtc" | "allDay" | "long">) {
  if (allDay) return long ? allDayLongLabel(startDate) : allDayLabel(startDate);
  const instant = startUtc ?? `${startDate}T00:00:00Z`;
  return long ? longDateLabel(instant, "UTC") : dateLabel(instant, "UTC");
}

function serverTime({
  startTime,
  startUtc,
  allDay,
}: Pick<Props, "startTime" | "startUtc" | "allDay">) {
  if (allDay) return "All day";
  const instant = startUtc ?? `1970-01-01T${startTime ?? "00:00:00"}Z`;
  return `${timeLabel(instant, "UTC")} UTC`;
}

export function LocalDateTime(props: Props) {
  const { startDate, startTime, startUtc, allDay, part, long = false } = props;
  const [value, setValue] = useState(() =>
    part === "date" ? serverDate(props) : serverTime(props),
  );

  useEffect(() => {
    if (allDay) return undefined;
    // After mount only: the first client render must equal the server HTML.
    const queued = window.setTimeout(() => {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const instant = eventInstant(startDate, startTime, startUtc);
      setValue(
        part === "date"
          ? long
            ? longDateLabel(instant, zone)
            : dateLabel(instant, zone)
          : `${timeLabel(instant, zone)} ${zoneLabel(instant, zone)}`,
      );
    }, 0);
    return () => window.clearTimeout(queued);
  }, [allDay, long, part, startDate, startTime, startUtc]);

  const title = allDay
    ? startDate
    : startUtc
      ? `${startUtc.slice(0, 16).replace("T", " ")} UTC`
      : `${startDate} ${startTime?.slice(0, 5) ?? ""} ${props.timezone ?? "UTC"}`;

  if (part === "date") {
    return (
      <time dateTime={startUtc ?? startDate} title={title}>
        {value}
      </time>
    );
  }
  return <span title={title}>{value}</span>;
}
