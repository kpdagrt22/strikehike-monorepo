import {
  allDayLabel,
  allDayLongLabel,
  dateLabel,
  longDateLabel,
  timeLabel,
} from "@/lib/events/localTime";

// A dated row's date or time. This is a server component: it renders the UTC
// value, which is also the no-JavaScript value, and tags the node so the one
// LocalTimeSync on the page can rewrite it to the reader's zone after mount.
// Rendering it as one client component per row made /upcoming hydrate dozens of
// islands for the same text.
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

  const title = allDay
    ? startDate
    : startUtc
      ? `${startUtc.slice(0, 16).replace("T", " ")} UTC`
      : `${startDate} ${startTime?.slice(0, 5) ?? ""} ${props.timezone ?? "UTC"}`;

  const data = {
    "data-ld": part,
    "data-sd": startDate,
    "data-su": startUtc ?? undefined,
    "data-st": startTime ?? undefined,
    "data-tz": props.timezone ?? undefined,
    "data-ad": allDay ? "" : undefined,
    "data-lg": long ? "" : undefined,
  };

  if (part === "date") {
    return (
      <time dateTime={startUtc ?? startDate} title={title} {...data}>
        {serverDate(props)}
      </time>
    );
  }
  return (
    <span title={title} {...data}>
      {serverTime(props)}
    </span>
  );
}
