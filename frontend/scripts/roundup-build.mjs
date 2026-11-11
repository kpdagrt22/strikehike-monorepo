// Pure roundup assembly, kept apart from the fetch-and-write script so the
// week boundaries, grouping and no-data omissions can be unit tested.

const DAY = 86_400_000;
const HIDDEN_THEMES = new Set(["Politics", "Natural Disasters"]);
const BUCKET_LABELS = {
  strong_bullish: "Risk elevated",
  calm_bullish: "Steady",
  bearish_warning: "Stressed",
  extreme_bearish: "Maximum fear",
};

export function weekRange(value) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value ?? "");
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
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

const dateOf = (event) => String(event?.start_date ?? "").slice(0, 10);

function regimeSection(atlas) {
  const latest = atlas?.meta?.latest_core_index ?? null;
  const timeline = Array.isArray(atlas?.timeline) ? atlas.timeline : [];
  if (!latest || !Number.isFinite(Number(latest.score)) || !latest.date) {
    return null;
  }
  const target = new Date(new Date(`${latest.date}T00:00:00Z`).getTime() - 7 * DAY)
    .toISOString()
    .slice(0, 10);
  const previous = [...timeline]
    .reverse()
    .find((point) => point?.date && point.date <= target);
  const previousScore =
    previous && Number.isFinite(Number(previous.core_index))
      ? Number(previous.core_index)
      : null;
  const score = Number(latest.score);
  const buckets = atlas?.meta?.core_index_buckets ?? {};
  const bucket = latest.bucket ? buckets[latest.bucket] : null;
  return {
    as_of: latest.date,
    score,
    label:
      BUCKET_LABELS[latest.bucket] ??
      bucket?.label ??
      latest.bucket ??
      "Core Index",
    previous_score: previousScore,
    change:
      previousScore == null
        ? null
        : Number((score - previousScore).toFixed(1)),
  };
}

function dateSections(upcoming, range) {
  const events = Object.values(upcoming?.themes ?? {}).flatMap((theme) =>
    (theme?.events ?? []).filter((event) => {
      const day = dateOf(event);
      return day && day >= range.start && day <= range.end;
    }),
  );
  const visible = events.filter(
    (event) => event.theme && !HIDDEN_THEMES.has(event.theme),
  );
  const byTheme = new Map();
  for (const event of visible) {
    const theme = event.theme;
    if (!theme) continue;
    if (!byTheme.has(theme)) byTheme.set(theme, []);
    byTheme.get(theme).push({
      id: event.event_id,
      name: event.name,
      start_date: dateOf(event),
      start_time: event.start_time ?? null,
      path: `/events/${String(event.event_id).replaceAll(":", "~")}`,
    });
  }
  const sky = (byTheme.get("Science") ?? []).slice();
  byTheme.delete("Science");
  const themes = [...byTheme.entries()]
    .map(([name, list]) => ({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      events: list.sort((a, b) => a.start_date.localeCompare(b.start_date)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { themes, sky, count: visible.length };
}

export function buildRoundup({
  week,
  atlas = null,
  upcoming = null,
  generatedAt = new Date().toISOString(),
}) {
  const range = weekRange(week);
  if (!range) throw new Error(`Invalid ISO week: ${week}`);
  const regime = regimeSection(atlas);
  const { themes, sky, count } = dateSections(upcoming, range);
  const lines = {};
  if (regime) {
    lines.regime = `Core Index ${regime.score >= 0 ? "+" : ""}${regime.score.toFixed(1)} (${regime.label})${
      regime.change == null
        ? ""
        : `, ${regime.change >= 0 ? "+" : ""}${regime.change.toFixed(1)} from last week`
    }.`;
  }
  if (themes.length > 0) {
    const dates = count - sky.length;
    lines.dates = `${dates} ${dates === 1 ? "date" : "dates"} in ${themes.length} ${
      themes.length === 1 ? "theme" : "themes"
    }.`;
  }
  if (sky.length > 0) {
    lines.sky = `${sky.length} sky ${sky.length === 1 ? "event" : "events"}.`;
  }
  return {
    week,
    start: range.start,
    end: range.end,
    generated_at: generatedAt,
    approved: false,
    ...(regime ? { regime } : {}),
    ...(themes.length ? { themes } : {}),
    ...(sky.length ? { sky } : {}),
    ...(Object.keys(lines).length ? { lines } : {}),
  };
}
