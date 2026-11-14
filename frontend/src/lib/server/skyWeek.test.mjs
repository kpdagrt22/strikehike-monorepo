import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalSkyQuery,
  skyWeekCacheKey,
  validSkyStart,
} from "./skyWeek.ts";

test("only a Monday inside the published range is valid", () => {
  assert.equal(validSkyStart("2026-11-16"), "2026-11-16");
  assert.equal(validSkyStart("2000-01-03"), "2000-01-03");
  assert.equal(validSkyStart("2040-12-31"), "2040-12-31");
  assert.equal(validSkyStart("2026-11-17"), null);
  assert.equal(validSkyStart("2026-02-30"), null);
  assert.equal(validSkyStart("not-a-date"), null);
  assert.equal(validSkyStart("1999-12-27"), null);
  assert.equal(validSkyStart("2041-01-07"), null);
  assert.equal(validSkyStart(null), null);
});

test("unknown parameters are dropped from the query and the cache key", () => {
  const noisy = new URLSearchParams(
    "start=2026-11-16&foo=bar&resolution=daily",
  );
  const query = canonicalSkyQuery(noisy);
  assert.equal(query, "start=2026-11-16");
  assert.equal(skyWeekCacheKey(query), "sky-week:start=2026-11-16");
  assert.equal(
    skyWeekCacheKey(
      canonicalSkyQuery(new URLSearchParams("start=2026-11-16&foo=baz")),
    ),
    "sky-week:start=2026-11-16",
  );
});
