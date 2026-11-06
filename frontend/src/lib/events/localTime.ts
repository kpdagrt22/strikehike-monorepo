// Pure date, time and zone-label formatting for upcoming events. No React,
// no browser APIs: the same functions run on the server and in the client.

const DATE_FORMAT = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  });

// With the year, for pages that stand alone (an event page, a year list).
const LONG_DATE_FORMAT = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });

const TIME_FORMAT = (timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });

export function eventInstant(
  startDate: string,
  startTime: string | null,
  startUtc: string | null,
) {
  if (startUtc) return startUtc;
  return `${startDate}T${startTime ?? "00:00:00"}Z`;
}

export function dateLabel(instant: string, timeZone: string) {
  return DATE_FORMAT(timeZone).format(new Date(instant));
}

export function longDateLabel(instant: string, timeZone: string) {
  return LONG_DATE_FORMAT(timeZone).format(new Date(instant));
}

export function timeLabel(instant: string, timeZone: string) {
  return TIME_FORMAT(timeZone).format(new Date(instant));
}

export function zoneLabel(instant: string, timeZone: string) {
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

/** An all-day date is a calendar date, never an instant in a zone. */
export function allDayLabel(value: string, timeZone?: string) {
  // The zone is accepted only so callers can show it is deliberately ignored.
  void timeZone;
  return DATE_FORMAT("UTC").format(new Date(`${value}T00:00:00Z`));
}

export function allDayLongLabel(value: string) {
  return LONG_DATE_FORMAT("UTC").format(new Date(`${value}T00:00:00Z`));
}
