"use client";

import { useEffect, useState } from "react";
import {
  allDayLabel,
  dateLabel,
  eventInstant,
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
};

function serverDate({
  startDate,
  startUtc,
  allDay,
}: Pick<Props, "startDate" | "startUtc" | "allDay">) {
  if (allDay) return allDayLabel(startDate);
  return dateLabel(startUtc ?? `${startDate}T00:00:00Z`, "UTC");
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
  const { startDate, startTime, startUtc, allDay, part } = props;
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
          ? dateLabel(instant, zone)
          : `${timeLabel(instant, zone)} ${zoneLabel(instant, zone)}`,
      );
    }, 0);
    return () => window.clearTimeout(queued);
  }, [allDay, part, startDate, startTime, startUtc]);

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
