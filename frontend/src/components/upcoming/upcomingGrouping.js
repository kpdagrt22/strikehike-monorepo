// The Upcoming pages share one flat, date-ordered list; /upcoming groups it by
// month, a theme page keeps its single theme group. Pure functions; the pages
// call them on the server.

const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function flatEvents(themes) {
  return themes
    .flatMap((theme) =>
      (theme.data.events ?? []).map((event) => ({ event, theme })),
    )
    .sort((left, right) => {
      const byDate = left.event.start_date.localeCompare(right.event.start_date);
      if (byDate) return byDate;
      return (left.event.start_utc ?? "").localeCompare(
        right.event.start_utc ?? "",
      );
    });
}

export function monthGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.event.start_date.slice(0, 7);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: MONTH.format(new Date(`${key}-01T00:00:00Z`)),
        items: [],
      });
    }
    groups.get(key).items.push(item);
  }
  return [...groups.values()];
}

export function themeGroup(theme, items) {
  return [{ key: theme.slug, label: theme.name, items }];
}

/** The earliest dated item; the payload already covers the next 12 months. */
export function nextItem(items) {
  return items[0] ?? null;
}
