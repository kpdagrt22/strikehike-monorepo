import { test } from "node:test";
import assert from "node:assert/strict";
import { windowsForClaim } from "./store.ts";

const WINDOWS = [
  {
    start: "2026-01-01",
    end: "2026-01-02",
    return: 0.1,
    decline_start: false,
    kind: "full_moon",
  },
];

test("a published claim returns its windows", () => {
  assert.deepEqual(windowsForClaim({ published: true, windows: WINDOWS }), {
    windows: WINDOWS,
  });
});

test("an unpublished claim has no public window list", () => {
  assert.equal(windowsForClaim({ published: false, windows: WINDOWS }), null);
});

test("a missing claim has no public window list", () => {
  assert.equal(windowsForClaim(null), null);
});
