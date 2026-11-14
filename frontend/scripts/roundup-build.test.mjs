import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRoundup,
  buildRoundupV2,
  staleReading,
  weekRange,
} from "./roundup-build.mjs";

const event = (id, name, date, theme) => ({
  event_id: id,
  name,
  start_date: `${date}T00:00:00`,
  start_time: "08:30:00",
  theme,
});

test("weekRange is Monday to Sunday and rejects a malformed week", () => {
  assert.deepEqual(weekRange("2026-W46"), {
    start: "2026-11-09",
    end: "2026-11-15",
  });
  assert.deepEqual(weekRange("2027-W01"), {
    start: "2027-01-04",
    end: "2027-01-10",
  });
  assert.equal(weekRange("2026-W00"), null);
  assert.equal(weekRange("2026-46"), null);
  assert.equal(weekRange(undefined), null);
});

test("the week boundary includes Monday and Sunday, and nothing outside", () => {
  const upcoming = {
    themes: {
      Finance: {
        events: [
          event("finance:a", "Sunday before", "2026-11-08", "Finance"),
          event("finance:b", "Monday", "2026-11-09", "Finance"),
          event("finance:c", "Sunday after", "2026-11-15", "Finance"),
          event("finance:d", "Monday after", "2026-11-16", "Finance"),
        ],
      },
    },
  };
  const roundup = buildRoundup({
    week: "2026-W46",
    upcoming,
    generatedAt: "2026-11-11T00:00:00.000Z",
  });
  assert.deepEqual(
    roundup.themes[0].events.map((item) => item.name),
    ["Monday", "Sunday after"],
  );
  assert.equal(roundup.lines.dates, "2 dates in 1 theme.");
});

test("a section with no data is left out, not filled with a placeholder", () => {
  const roundup = buildRoundup({
    week: "2026-W46",
    atlas: { meta: {}, timeline: [] },
    upcoming: { themes: {} },
    generatedAt: "2026-11-11T00:00:00.000Z",
  });
  assert.equal("regime" in roundup, false);
  assert.equal("themes" in roundup, false);
  assert.equal("sky" in roundup, false);
  assert.equal("lines" in roundup, false);
  assert.equal(roundup.approved, false);
});

test("the Regime section carries the score, label and weekly change", () => {
  const atlas = {
    meta: {
      latest_core_index: { date: "2026-11-06", score: 15.76, bucket: "calm_bullish" },
      core_index_buckets: { calm_bullish: "0 to 24" },
    },
    timeline: [
      { date: "2026-10-30", core_index: 16.53 },
      { date: "2026-11-06", core_index: 15.76 },
    ],
  };
  const roundup = buildRoundup({
    week: "2026-W46",
    atlas,
    generatedAt: "2026-11-11T00:00:00.000Z",
  });
  assert.deepEqual(roundup.regime, {
    as_of: "2026-11-06",
    score: 15.76,
    label: "Steady",
    previous_score: 16.53,
    change: -0.8,
  });
  assert.equal(
    roundup.lines.regime,
    "Core Index +15.8 (Steady), -0.8 from last week.",
  );
  assert.equal("themes" in roundup, false);
});

test("hidden themes are left out of the dates section and its count", () => {
  const upcoming = {
    themes: {
      Politics: {
        events: [event("politics:p", "Election", "2026-11-10", "Politics")],
      },
      Finance: {
        events: [event("finance:f", "Employment", "2026-11-13", "Finance")],
      },
    },
  };
  const roundup = buildRoundup({
    week: "2026-W46",
    upcoming,
    generatedAt: "2026-11-11T00:00:00.000Z",
  });
  assert.deepEqual(
    roundup.themes.map((theme) => theme.name),
    ["Finance"],
  );
  assert.equal(roundup.lines.dates, "1 date in 1 theme.");
  assert.equal("politics" in roundup, false);
});

test("Science dates are the sky section, not a theme; other themes group", () => {
  const upcoming = {
    themes: {
      Science: {
        events: [event("science:s", "Solstice", "2026-11-12", "Science")],
      },
      Finance: {
        events: [
          event("finance:f", "Employment", "2026-11-13", "Finance"),
          event("finance:g", "CPI", "2026-11-10", "Finance"),
        ],
      },
    },
  };
  const roundup = buildRoundup({
    week: "2026-W46",
    upcoming,
    generatedAt: "2026-11-11T00:00:00.000Z",
  });
  assert.deepEqual(
    roundup.themes.map((theme) => theme.name),
    ["Finance"],
  );
  assert.deepEqual(
    roundup.themes[0].events.map((item) => item.name),
    ["CPI", "Employment"],
  );
  assert.equal(roundup.themes[0].events[0].path, "/events/finance~g");
  assert.deepEqual(
    roundup.sky.map((item) => item.name),
    ["Solstice"],
  );
  assert.equal(roundup.lines.dates, "2 dates in 1 theme.");
  assert.equal(roundup.lines.sky, "1 sky event.");
});

const claims = {
  eclipses: {
    title: "Eclipses and the market",
    result: "No meaningful difference in this record.",
    result_code: "no_meaningful_difference",
  },
  "mercury-retrograde": {
    title: "Mercury retrograde and the market",
    result: "No meaningful difference in this record.",
    result_code: "no_meaningful_difference",
  },
  "mars-retrograde": {
    title: "Mars retrograde and the market",
    result: "No meaningful difference in this record.",
    result_code: "no_meaningful_difference",
  },
  "mars-saturn-conjunction": {
    title: "Mars–Saturn conjunctions and the market",
    result: "No meaningful difference in this record.",
    result_code: "no_meaningful_difference",
  },
  "solstices-equinoxes": {
    title: "Solstices, equinoxes and the market",
    result: "No meaningful difference in this record.",
    result_code: "no_meaningful_difference",
  },
  "full-moon": {
    title: "The full moon and the market",
    result: "No meaningful difference in this record.",
    result_code: "no_meaningful_difference",
  },
  "new-moon": {
    title: "The new moon and the market",
    result: "No meaningful difference in this record.",
    result_code: "no_meaningful_difference",
  },
};

const sky = (overrides = {}) => ({
  moon_phases: [],
  stations: [],
  ingresses: [],
  eclipses: [],
  seasons: [],
  conjunctions: [],
  activity: {
    daily: [
      { date: "2026-11-16", score: 40 },
      { date: "2026-11-17", score: 55 },
    ],
    min: 40,
    max: 55,
    peak_date: "2026-11-17",
    closest_past: {
      date: "1990-04-24",
      name: "Hubble launch",
      similarity_percent: 80,
    },
    note: "Geometry match compares planet positions only; it predicts nothing.",
  },
  ...overrides,
});

test("staleReading refuses a reading more than ten days before Monday", () => {
  assert.equal(staleReading("2026-11-06", "2026-11-16", 10), null);
  assert.equal(staleReading("2026-11-05", "2026-11-16", 10), 11);
  assert.equal(staleReading(null, "2026-11-16", 10), null);
});

test("next two weeks starts the day after Sunday and ends fourteen days later", () => {
  const upcoming = {
    themes: {
      Finance: {
        events: [
          event("finance:a", "Sunday", "2026-11-15", "Finance"),
          event("finance:b", "Monday next", "2026-11-16", "Finance"),
          event("finance:c", "Two weeks", "2026-11-29", "Finance"),
          event("finance:d", "Too late", "2026-11-30", "Finance"),
          event("politics:p", "Hidden", "2026-11-17", "Politics"),
        ],
      },
    },
  };
  const roundup = buildRoundupV2({
    week: "2026-W46",
    upcoming,
    skyWeek: sky(),
    claims,
    generatedAt: "2026-11-11T00:00:00.000Z",
  });
  assert.deepEqual(
    roundup.next_two_weeks.map((item) => item.name),
    ["Monday next", "Two weeks"],
  );
});

test("the v2 fixture carries every section", () => {
  const atlas = {
    meta: {
      latest_core_index: {
        date: "2026-11-13",
        score: 13.2,
        bucket: "calm_bullish",
      },
    },
    timeline: [
      { date: "2026-10-23", core_index: 11.1 },
      { date: "2026-10-30", core_index: 11.8 },
      { date: "2026-11-06", core_index: 12.4 },
      { date: "2026-11-13", core_index: 13.2 },
    ],
  };
  const upcoming = {
    themes: {
      Finance: {
        events: [
          event("finance:f", "Employment", "2026-11-17", "Finance"),
          event("finance:g", "CPI", "2026-11-24", "Finance"),
        ],
      },
    },
  };
  const roundup = buildRoundupV2({
    week: "2026-W47",
    atlas,
    upcoming,
    skyWeek: sky({
      moon_phases: [
        {
          kind: "new_moon",
          body: "Moon",
          at: "2026-11-18T00:00:00Z",
          path: "/upcoming/science",
        },
      ],
    }),
    claims,
    generatedAt: "2026-11-14T00:00:00.000Z",
  });
  assert.equal(roundup.schema, 2);
  assert.equal(roundup.regime.weekly.length, 4);
  assert.equal(roundup.sky_week_items[0].label, "New moon");
  assert.equal(roundup.activity.max, 55);
  assert.equal(roundup.next_two_weeks.length, 1);
  assert.equal(roundup.from_record.claim_id, "new-moon");
  assert.equal(roundup.lines.sky, "1 sky event this week.");
});

test("from the record follows the fixed priority order", () => {
  const week = (overrides) =>
    buildRoundupV2({
      week: "2026-W46",
      skyWeek: sky(overrides),
      claims,
      generatedAt: "2026-11-11T00:00:00.000Z",
    }).from_record.claim_id;
  const phase = [
    {
      kind: "full_moon",
      body: "Moon",
      at: "2026-11-10T00:00:00Z",
      path: "/upcoming/science",
    },
  ];
  const station = (body) => [
    {
      kind: "station_retrograde",
      body,
      at: "2026-11-10T00:00:00Z",
      path: "/upcoming/science",
    },
  ];
  assert.equal(
    week({
      eclipses: [
        {
          kind: "solar_eclipse",
          body: "Sun",
          at: "2026-11-10T00:00:00Z",
        },
      ],
      stations: station("Mercury"),
    }),
    "eclipses",
  );
  assert.equal(
    week({ stations: [...station("Mercury"), ...station("Mars")] }),
    "mercury-retrograde",
  );
  assert.equal(week({ stations: station("Mars") }), "mars-retrograde");
  assert.equal(
    week({
      conjunctions: [
        {
          kind: "mars_saturn_conjunction",
          body: "Mars",
          at: "2026-11-10T00:00:00Z",
        },
      ],
    }),
    "mars-saturn-conjunction",
  );
  assert.equal(
    week({
      seasons: [
        { kind: "season", body: "Sun", at: "2026-11-10T00:00:00Z" },
      ],
    }),
    "solstices-equinoxes",
  );
  assert.equal(week({ moon_phases: phase }), "full-moon");
  assert.equal(
    week({
      moon_phases: [
        {
          kind: "new_moon",
          body: "Moon",
          at: "2026-11-10T00:00:00Z",
        },
      ],
    }),
    "new-moon",
  );
});
