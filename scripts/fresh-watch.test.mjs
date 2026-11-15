import assert from "node:assert/strict";
import test from "node:test";
import { daysOld, evaluate, isoWeekMonday, todayIst } from "./fresh-watch.mjs";

const PASSING = {
  today: "2026-11-15",
  regimeAsOf: "2026-11-08",
  roundupWeek: "2026-W47",
  bundleCreatedAt: "2026-11-09T01:09:42.858380Z",
  healthStatus: 200,
  sitemapStatus: 200,
  thisWeekLastmod: "2026-11-14",
};

test("ISO week Monday", () => {
  assert.equal(isoWeekMonday("2026-W47"), "2026-11-16");
  assert.equal(isoWeekMonday("2026-W01"), "2025-12-29");
  assert.equal(isoWeekMonday("2020-W53"), "2020-12-28");
  assert.equal(isoWeekMonday("2026-47"), null);
});

test("day arithmetic is calendar days, not hours", () => {
  assert.equal(daysOld("2026-11-15", "2026-11-08"), 7);
  assert.equal(daysOld("2026-11-15", "2026-11-16"), -1);
  assert.equal(daysOld("2026-11-15", "not-a-date"), null);
});

test("all six checks pass on a fresh day", () => {
  const rows = evaluate(PASSING);
  assert.equal(rows.length, 6);
  assert.deepEqual(
    rows.map((row) => row.ok),
    [true, true, true, true, true, true],
  );
});

test("each stale or broken input fails its own row", () => {
  const cases = [
    { regimeAsOf: "2026-10-01" },
    { roundupWeek: "2026-W44" },
    { bundleCreatedAt: "2026-10-01T00:00:00Z" },
    { healthStatus: 503 },
    { sitemapStatus: 404 },
    { thisWeekLastmod: "2026-10-01" },
  ];
  for (const override of cases) {
    const rows = evaluate({ ...PASSING, ...override });
    assert.equal(
      rows.filter((row) => !row.ok).length,
      1,
      JSON.stringify(override),
    );
  }
});

test("missing values fail rather than pass", () => {
  const rows = evaluate({
    today: "2026-11-15",
    healthStatus: undefined,
    sitemapStatus: undefined,
  });
  assert.equal(rows.filter((row) => row.ok).length, 0);
});

test("todayIst follows Asia/Kolkata", () => {
  const lateUtc = new Date("2026-11-15T20:00:00Z");
  assert.equal(todayIst(lateUtc), "2026-11-16");
});
