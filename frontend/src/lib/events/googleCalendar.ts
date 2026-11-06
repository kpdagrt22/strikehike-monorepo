// A Google Calendar "add event" template link. The .ics download is the
// canonical path; this is the same date in Google's own form.
// https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…&details=…

type CalendarEvent = {
  name: string;
  start_date: string;
  start_time: string | null;
  start_utc: string | null;
  all_day: boolean;
  timezone: string | null;
};

function utcStamp(instant: string) {
  return instant.replace(/[-:]/g, "").replace(/\.\d+/, "").replace(/Z?$/, "Z");
}

function dayStamp(value: string, addDays = 0) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + addDays);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function googleCalendarUrl(
  event: CalendarEvent,
  { details }: { details: string },
): string {
  const dates = event.all_day
    ? `${dayStamp(event.start_date)}/${dayStamp(event.start_date, 1)}`
    : event.start_utc
      ? `${utcStamp(event.start_utc)}/${utcStamp(
          new Date(Date.parse(event.start_utc) + 30 * 60_000).toISOString(),
        )}`
      : // A timed event without a computed instant should not exist; fall back to all-day.
        `${dayStamp(event.start_date)}/${dayStamp(event.start_date, 1)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.name,
    dates,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
