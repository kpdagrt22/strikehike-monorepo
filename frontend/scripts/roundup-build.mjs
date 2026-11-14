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
const RASHIS = [
  "Mesha",
  "Vrishabha",
  "Mithuna",
  "Karka",
  "Simha",
  "Kanya",
  "Tula",
  "Vrishchika",
  "Dhanu",
  "Makara",
  "Kumbha",
  "Meena",
];
const PHASE_LABELS = {
  new_moon: "New moon",
  first_quarter: "First quarter",
  full_moon: "Full moon",
  last_quarter: "Last quarter",
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

function regimeSection(atlas, { weekly = false } = {}) {
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
  const result = {
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
  if (weekly) {
    result.weekly = [...timeline]
      .filter(
        (point) =>
          point?.date &&
          point.date <= latest.date &&
          Number.isFinite(Number(point.core_index)),
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-4)
      .map((point) => ({
        date: point.date,
        score: Number(point.core_index),
      }));
  }
  return result;
}

export function staleReading(as_of, weekStart, maxDays = 10) {
  if (!as_of || !weekStart) return null;
  const days = Math.floor(
    (new Date(`${weekStart}T00:00:00Z`).getTime() -
      new Date(`${as_of}T00:00:00Z`).getTime()) /
      DAY,
  );
  return days > maxDays ? days : null;
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

function flatVisibleEvents(upcoming, start, end, limit) {
  const events = Object.values(upcoming?.themes ?? {})
    .flatMap((theme) => theme?.events ?? [])
    .filter((event) => {
      const day = dateOf(event);
      return (
        day &&
        day >= start &&
        day <= end &&
        event.theme &&
        !HIDDEN_THEMES.has(event.theme)
      );
    })
    .sort((a, b) => {
      const day = dateOf(a).localeCompare(dateOf(b));
      return day || String(a.start_time ?? "").localeCompare(String(b.start_time ?? ""));
    })
    .slice(0, limit);
  return events.map((event) => ({
    id: event.event_id,
    name: event.name,
    theme: event.theme,
    start_date: dateOf(event),
    start_time: event.start_time ?? null,
    path: `/events/${String(event.event_id).replaceAll(":", "~")}`,
  }));
}

function skyLabel(item) {
  if (item.kind in PHASE_LABELS) return PHASE_LABELS[item.kind];
  if (item.kind === "station_retrograde") return `${item.body} retrograde begins`;
  if (item.kind === "station_direct") return `${item.body} direct begins`;
  if (item.kind === "ingress") {
    return `${item.body} enters ${RASHIS[Number(item.rashi) % 12]}`;
  }
  if (item.kind === "solar_eclipse") {
    return `${String(item.eclipse_type ?? "Solar")} solar eclipse`;
  }
  if (item.kind === "lunar_eclipse") {
    return `${String(item.eclipse_type ?? "Lunar")} lunar eclipse`;
  }
  if (item.kind === "season") return item.name ?? "Equinox or solstice";
  if (item.kind === "mars_saturn_conjunction") {
    return "Mars–Saturn conjunction";
  }
  return `${item.body ?? "Sky"} event`;
}

function skyItems(skyWeek) {
  if (!skyWeek) return [];
  return [
    ...(skyWeek.moon_phases ?? []),
    ...(skyWeek.stations ?? []),
    ...(skyWeek.ingresses ?? []),
    ...(skyWeek.eclipses ?? []),
    ...(skyWeek.seasons ?? []),
    ...(skyWeek.conjunctions ?? []),
  ]
    .filter((item) => item?.at)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((item) => ({ ...item, label: skyLabel(item) }));
}

function claimForWeek(skyWeek, claims) {
  const stations = skyWeek?.stations ?? [];
  const eclipses = skyWeek?.eclipses ?? [];
  const conjunctions = skyWeek?.conjunctions ?? [];
  const seasons = skyWeek?.seasons ?? [];
  const phases = skyWeek?.moon_phases ?? [];
  let id = null;
  if (eclipses.length) id = "eclipses";
  else if (stations.some((item) => item.body === "Mercury")) {
    id = "mercury-retrograde";
  } else if (stations.some((item) => item.body === "Mars")) {
    id = "mars-retrograde";
  } else if (conjunctions.length) {
    id = "mars-saturn-conjunction";
  } else if (seasons.length) {
    id = "solstices-equinoxes";
  } else if (phases.some((item) => item.kind === "full_moon")) {
    id = "full-moon";
  } else if (phases.some((item) => item.kind === "new_moon")) {
    id = "new-moon";
  }
  const claim = id ? claims?.[id] : null;
  if (!claim) return null;
  return {
    claim_id: id,
    title: claim.title,
    result: claim.result,
    result_code: claim.result_code,
    path: `/tested/${id}`,
  };
}

export function buildRoundupV2({
  week,
  atlas = null,
  upcoming = null,
  skyWeek = null,
  claims = {},
  generatedAt = new Date().toISOString(),
}) {
  const range = weekRange(week);
  if (!range) throw new Error(`Invalid ISO week: ${week}`);
  const regime = regimeSection(atlas, { weekly: true });
  const { themes, sky: inWeekSky, count } = dateSections(upcoming, range);
  const sky = skyItems(skyWeek);
  const activity = skyWeek?.activity ?? null;
  const nextStart = new Date(`${range.end}T00:00:00Z`);
  nextStart.setUTCDate(nextStart.getUTCDate() + 1);
  const nextEnd = new Date(nextStart);
  nextEnd.setUTCDate(nextEnd.getUTCDate() + 13);
  const next_two_weeks = flatVisibleEvents(
    upcoming,
    nextStart.toISOString().slice(0, 10),
    nextEnd.toISOString().slice(0, 10),
    6,
  );
  const from_record = claimForWeek(skyWeek, claims);
  const lines = {};
  if (regime) {
    lines.regime = `Core Index ${regime.score >= 0 ? "+" : ""}${regime.score.toFixed(1)} (${regime.label})${
      regime.change == null
        ? ""
        : `, ${regime.change >= 0 ? "+" : ""}${regime.change.toFixed(1)} from last week`
    }.`;
  }
  if (themes.length > 0) {
    const dates = count - inWeekSky.length;
    lines.dates = `${dates} ${dates === 1 ? "date" : "dates"} in ${themes.length} ${
      themes.length === 1 ? "theme" : "themes"
    }.`;
  }
  if (sky.length > 0) {
    lines.sky = `${sky.length} sky ${sky.length === 1 ? "event" : "events"} this week.`;
  }
  if (activity?.daily?.length) {
    const closest = activity.closest_past;
    const range =
      activity.min === activity.max
        ? `Sky activity was ${activity.min} all week (peak day ${activity.peak_date})`
        : `Sky activity ran ${activity.min}–${activity.max}, peaking on ${activity.peak_date}`;
    lines.activity = `${range}${
      closest
        ? `; the closest past sky was ${closest.date} at ${closest.similarity_percent}% geometry match`
        : ""
    }.`;
  }
  if (next_two_weeks.length > 0) {
    lines.next = `${next_two_weeks.length} ${
      next_two_weeks.length === 1 ? "date" : "dates"
    } in the next two weeks.`;
  }
  if (from_record) {
    lines.record = `From the record: ${from_record.title} — ${from_record.result}`;
  }
  return {
    schema: 2,
    week,
    start: range.start,
    end: range.end,
    generated_at: generatedAt,
    approved: false,
    ...(regime ? { regime } : {}),
    ...(themes.length ? { themes } : {}),
    ...(sky.length ? { sky_week: skyWeek, sky_week_items: sky } : {}),
    ...(activity ? { activity } : {}),
    ...(next_two_weeks.length ? { next_two_weeks } : {}),
    ...(from_record ? { from_record } : {}),
    ...(Object.keys(lines).length ? { lines } : {}),
  };
}
