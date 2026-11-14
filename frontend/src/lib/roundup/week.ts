// ISO week helpers shared by the roundup script, pages, RSS and tests.
// Monday to Sunday, UTC.

/** The only week shape any public route may pass to the filesystem. */
export const WEEK_PATTERN = /^\d{4}-W\d{2}$/;

export function isIsoWeek(value: string): boolean {
  return WEEK_PATTERN.test(value);
}

export function parseIsoWeek(value: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { week: value, start: iso(monday), end: iso(sunday) };
}

export function isoWeekOf(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const target = new Date(date);
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const year = target.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((target.getTime() - first.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function weekLabel(value: string) {
  const range = parseIsoWeek(value);
  if (!range) return value;
  const format = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${format.format(new Date(`${range.start}T00:00:00Z`))} – ${format.format(
    new Date(`${range.end}T00:00:00Z`),
  )}`;
}

export function inWeek(date: string, week: { start: string; end: string }) {
  return date >= week.start && date <= week.end;
}
