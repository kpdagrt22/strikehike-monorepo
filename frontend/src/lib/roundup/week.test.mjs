import assert from "node:assert/strict";
import test from "node:test";
import { inWeek, isoWeekOf, parseIsoWeek, weekLabel } from "./week.ts";

test("parseIsoWeek starts on Monday and ends on Sunday", () => {
  assert.deepEqual(parseIsoWeek("2026-W46"), {
    week: "2026-W46",
    start: "2026-11-09",
    end: "2026-11-15",
  });
  assert.deepEqual(parseIsoWeek("2027-W01"), {
    week: "2027-W01",
    start: "2027-01-04",
    end: "2027-01-10",
  });
  assert.equal(parseIsoWeek("2026-W54"), null);
  assert.equal(parseIsoWeek("nope"), null);
});

test("isoWeekOf maps the boundary days to the right ISO week", () => {
  assert.equal(isoWeekOf("2026-11-09"), "2026-W46");
  assert.equal(isoWeekOf("2026-11-15"), "2026-W46");
  assert.equal(isoWeekOf("2026-11-08"), "2026-W45");
  assert.equal(isoWeekOf("2026-11-16"), "2026-W47");
});

test("inWeek compares ISO days inclusively", () => {
  const week = { start: "2026-11-09", end: "2026-11-15" };
  assert.equal(inWeek("2026-11-09", week), true);
  assert.equal(inWeek("2026-11-15", week), true);
  assert.equal(inWeek("2026-11-08", week), false);
  assert.equal(inWeek("2026-11-16", week), false);
});

test("weekLabel names both ends of the week", () => {
  assert.match(weekLabel("2026-W46"), /9 Nov 2026/);
  assert.match(weekLabel("2026-W46"), /15 Nov 2026/);
});
