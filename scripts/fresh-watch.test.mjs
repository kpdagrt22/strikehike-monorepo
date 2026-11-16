import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  daysOld,
  evaluate,
  isoWeekMonday,
  lastSunday,
  markdown,
  regimeDispatchHint,
  todayIst,
} from "./fresh-watch.mjs";

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

test("the Regime threshold stays 9 days: GitHub can start the Sunday cron ~4 h late", () => {
  // 2026-11-08 is a Sunday reading; on Tue 17 Nov it is 9 days old (pass),
  // on Wed 18 Nov 10 days old (fail).
  assert.equal(evaluate({ ...PASSING, today: "2026-11-17" })[0].ok, true);
  assert.equal(evaluate({ ...PASSING, today: "2026-11-18" })[0].ok, false);
});

test("lastSunday is the cron's UTC build date", () => {
  assert.equal(lastSunday("2026-11-16"), "2026-11-15"); // Monday
  assert.equal(lastSunday("2026-11-15"), "2026-11-15"); // Sunday itself
  assert.equal(lastSunday("2026-11-21"), "2026-11-15"); // Saturday
  assert.equal(lastSunday("2027-01-02"), "2026-12-27"); // across a year
  assert.equal(lastSunday("not-a-date"), null);
});

test("a stale Regime reading names the manual dispatch command", () => {
  const rows = evaluate({ ...PASSING, today: "2026-11-18" });
  const regime = rows[0];
  assert.equal(regime.ok, false);
  assert.match(
    regime.hint,
    /`gh workflow run events-weekly\.yml -f today=2026-11-15`/,
  );
  assert.match(regime.hint, /never dispatches/);
  const text = markdown(rows, "https://strikehike.com", "2026-11-18");
  assert.match(text, /Overall: \*\*FAIL\*\*/);
  assert.match(
    text,
    /- \*\*Newest Regime reading:\*\* .*gh workflow run events-weekly\.yml -f today=2026-11-15/,
  );
  // A missing reading gets the same command.
  const missing = evaluate({ ...PASSING, regimeAsOf: undefined })[0];
  assert.match(missing.hint, /-f today=2026-11-15/);
});

test("a fresh reading carries no hint and the summary has no command", () => {
  const rows = evaluate(PASSING);
  assert.equal(rows[0].hint, undefined);
  assert.doesNotMatch(markdown(rows, "https://strikehike.com", PASSING.today), /gh workflow run/);
  assert.match(regimeDispatchHint("2026-11-16"), /today=2026-11-15/);
});

test("fresh-watch never dispatches: no write API in the script, no actions: write in the workflow", () => {
  const source = readFileSync(new URL("./fresh-watch.mjs", import.meta.url), "utf8");
  // The REST dispatch path, a shell-out (gh workflow run) or any POST.
  assert.doesNotMatch(source, /\/dispatches|child_process|method:\s*["']POST/);
  const workflow = readFileSync(
    new URL("../.github/workflows/fresh-watch.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /permissions:\s*\n\s*contents: read\s*\n/);
  assert.doesNotMatch(workflow, /actions:\s*write|gh workflow run/);
});
