import assert from "node:assert/strict";
import test from "node:test";

import { lastModified, laterDate } from "./lastmod.ts";

test("laterDate picks the latest day and ignores empty values", () => {
  assert.equal(
    laterDate("2026-11-03", undefined, null, "2026-11-13", "2026-11-08"),
    "2026-11-13",
  );
  assert.equal(laterDate(undefined, null, ""), undefined);
  assert.equal(laterDate("not-a-date", "2026-02-30"), "2026-02-30");
});

test("lastModified never falls below the page's copy date", () => {
  assert.equal(lastModified("2026-11-03"), "2026-11-03");
  assert.equal(lastModified("2026-11-03", "2026-10-27"), "2026-11-03");
  assert.equal(lastModified("2026-11-03", "2026-11-08"), "2026-11-08");
});
