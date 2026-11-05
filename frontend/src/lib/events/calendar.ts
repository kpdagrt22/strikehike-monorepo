export type CalendarScope =
  | "all"
  | "science"
  | "finance"
  | "culture-religion";

const NAME: Record<Exclude<CalendarScope, "all">, string> = {
  science: "Science",
  finance: "Finance",
  "culture-religion": "Culture/Religion",
};

export function calendarSlug(scope: CalendarScope) {
  return scope;
}

export function calendarName(scope: CalendarScope) {
  return scope === "all"
    ? "StrikeHike · Upcoming dates"
    : `StrikeHike · ${NAME[scope]}`;
}
