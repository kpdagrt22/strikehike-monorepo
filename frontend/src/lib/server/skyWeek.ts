/** Shared validation and canonical query for the public sky-week proxy. */

export const SKY_START_MIN = "2000-01-03";
export const SKY_START_MAX = "2040-12-31";

/** A start must be a real ISO date, a Monday, and inside the published range. */
export function validSkyStart(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== value) return null;
  if (date.getUTCDay() !== 1) return null;
  if (value < SKY_START_MIN || value > SKY_START_MAX) return null;
  return value;
}

/** Only `start` survives, so unknown parameters cannot reach FastAPI. */
export function canonicalSkyQuery(searchParams: URLSearchParams): string {
  const start = validSkyStart(searchParams.get("start"));
  return start ? `start=${start}` : "";
}

/** The cache key is built from the canonical query, never the raw URL. */
export function skyWeekCacheKey(query: string): string {
  return `sky-week:${query}`;
}
