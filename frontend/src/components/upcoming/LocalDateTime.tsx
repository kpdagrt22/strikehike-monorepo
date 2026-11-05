"use client";

import { useEffect, useState } from "react";

type Props = {
  startDate: string;
  startTime: string | null;
  startUtc: string | null;
  timezone: string | null;
  allDay: boolean;
  part: "date" | "time";
};

const DATE_FORMAT = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  });

const TIME_FORMAT = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });

function instantOf(startDate: string, startTime: string | null, startUtc: string | null) {
  if (startUtc) return startUtc;
  return `${startDate}T${startTime ?? "00:00:00"}Z`;
}

function dateLabel(instant: string, timeZone: string) {
  return DATE_FORMAT(timeZone).format(new Date(instant));
}

function timeLabel(instant: string, timeZone: string) {
  return TIME_FORMAT(timeZone).format(new Date(instant));
}

function zoneLabel(instant: string, timeZone: string) {
  if (timeZone === "Asia/Kolkata" || timeZone === "Asia/Calcutta") return "IST";
  const locale = timeZone.startsWith("Europe/") ? "en-GB" : "en-US";
  const parts = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date(instant));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

function serverDate({
  startDate,
  startUtc,
  allDay,
}: Pick<Props, "startDate" | "startUtc" | "allDay">) {
  if (allDay) return DATE_FORMAT("UTC").format(new Date(`${startDate}T00:00:00Z`));
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
      const instant = instantOf(startDate, startTime, startUtc);
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
