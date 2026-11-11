import assert from "node:assert/strict";
import test from "node:test";
import { buildRoundup, weekRange } from "./roundup-build.mjs";

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
