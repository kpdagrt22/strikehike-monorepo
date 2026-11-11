import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AURA_BOX, FACE_RADIUS, RING_OUTER, auraTier } from "./crown.ts";

const GLOBALS = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8")
  .replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));

test("auraTier keeps the 85 / 90 / 95 thresholds", () => {
  const cases = [
    [84.9, 0],
    [85, 1],
    [89.9, 1],
    [90, 2],
    [94.9, 2],
    [95, 3],
    [100, 3],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [null, 0],
    [undefined, 0],
  ];
  for (const [score, tier] of cases) {
    assert.equal(auraTier(score), tier, `score ${score}`);
  }
});

test("the face sits inside the ring, and every box has room for the corona", () => {
  assert.ok(FACE_RADIUS < RING_OUTER);
  for (const box of Object.values(AURA_BOX)) {
    assert.ok(box / 2 - RING_OUTER >= 25, `box ${box}`);
  }
});

test("globals.css has every corona keyframe, none reading a CSS variable", () => {
  const names = [
    "sh-aura-in",
    "sh-corona-breathe",
    "sh-corona-breathe-light",
    "sh-corona-turn",
    "sh-corona-turn-back",
    "sh-corona-rim",
    "sh-corona-rim-light",
    "sh-corona-twinkle",
  ];
  for (const name of names) {
    const start = GLOBALS.indexOf(`@keyframes ${name} {`);
    assert.ok(start >= 0, `@keyframes ${name}`);
    // A keyframe block ends at the first line that closes it at column 0.
    const body = GLOBALS.slice(start, GLOBALS.indexOf("\n}\n", start));
    assert.ok(!body.includes("var("), `${name} reads a CSS variable`);
  }
});

test("reduced motion stops every corona animation", () => {
  assert.match(
    GLOBALS,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.sh-aura,\s*\.sh-aura \* \{\s*animation: none !important;/,
  );
  assert.ok(!GLOBALS.includes(".sh-flame"), "no flame rules left behind");
});
