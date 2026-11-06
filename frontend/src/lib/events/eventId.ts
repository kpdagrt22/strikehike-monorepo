// Event ids and the URLs built from them. Pure: safe on the server and in the browser.
//
// An id is `<theme>:<source>:<fragment>`, the grammar the backend checks before any lookup
// (backend events/models.py EVENT_ID_PATTERN, the analytics schema's event_id pattern). In a
// URL every ":" becomes "~": the grammar never contains "~", so the swap is reversible, and the
// result is a plain path segment that is also a safe download file name.
import { TIMELINE_MAX, TIMELINE_MIN } from "@/lib/timeline";

export const EVENT_ID_PATTERN = /^[a-z-]+:[a-z0-9_-]+:[A-Za-z0-9:._-]+$/;
export const EVENT_ID_MAX_LENGTH = 160;

export function isEventId(value: string): boolean {
  return value.length <= EVENT_ID_MAX_LENGTH && EVENT_ID_PATTERN.test(value);
}

export function eventSlug(id: string): string {
  return id.replaceAll(":", "~");
}

/** The id behind a URL segment ("~" or an encoded ":"), or null when it is not an id. */
export function eventIdFromSlug(slug: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const id = decoded.replaceAll("~", ":");
  return isEventId(id) ? id : null;
}

export function eventPath(id: string): string {
  return `/events/${eventSlug(id)}`;
}

export function eventCalendarPath(id: string): string {
  return `/calendar/event/${eventSlug(id)}.ics`;
}

type SkyEvent = { start_date: string; start_utc?: string | null };

/** The UTC day the orrery opens on for this event: its instant's day, else its date. */
export function skyDate(event: SkyEvent): string {
  return (event.start_utc ?? event.start_date).slice(0, 10);
}

/** `/?d=YYYY-MM-DD`, or null when the date is outside the orrery's timeline. */
export function skyHref(event: SkyEvent): string | null {
  const date = skyDate(event);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (date < TIMELINE_MIN || date > TIMELINE_MAX) return null;
  return `/?d=${date}`;
}
