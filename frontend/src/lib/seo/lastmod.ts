/** Date-only lastmod arithmetic. Never the build or request time. */

const DAY = /^\d{4}-\d{2}-\d{2}/;

export function laterDate(
  ...values: (string | null | undefined)[]
): string | undefined {
  let latest: string | undefined;
  for (const value of values) {
    if (typeof value !== "string" || !DAY.test(value)) continue;
    const day = value.slice(0, 10);
    if (!latest || day > latest) latest = day;
  }
  return latest;
}

/** The later of the page's own copy date and any data date it carries. */
export function lastModified(
  contentDate: string,
  ...dataDates: (string | null | undefined)[]
): string {
  return laterDate(contentDate, ...dataDates) ?? contentDate;
}
