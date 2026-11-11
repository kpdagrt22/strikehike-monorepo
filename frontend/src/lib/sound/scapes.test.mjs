import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ON,
  DEFAULT_SCAPE,
  DEFAULT_VOLUME,
  autostartChoice,
  modeOf,
  parsePrefs,
} from "./scapes.ts";

test("nothing saved, or junk saved, reads as a first visit", () => {
  for (const raw of [null, "", "{", "[]", '{"choice":"jazz"}', "null"]) {
    assert.equal(parsePrefs(raw), null, String(raw));
  }
});

test("a saved choice keeps its scape, clamps the volume and remembers the last scape", () => {
  assert.deepEqual(parsePrefs('{"choice":"orbit","volume":0.3}'), {
    choice: "orbit",
    volume: 0.3,
    last: "orbit",
  });
  assert.deepEqual(parsePrefs('{"choice":"off","volume":7,"last":"wind"}'), {
    choice: "off",
    volume: 1,
    last: "wind",
  });
  assert.deepEqual(parsePrefs('{"choice":"off"}'), {
    choice: "off",
    volume: DEFAULT_VOLUME,
    last: DEFAULT_SCAPE,
  });
});

test("sound is on by default, and off stays off", () => {
  assert.equal(DEFAULT_ON, true);
  assert.equal(modeOf(null), DEFAULT_SCAPE);
  assert.equal(modeOf({ choice: "off", volume: 0.5, last: "orbit" }), "off");
  assert.equal(modeOf({ choice: "wind", volume: 0.5, last: "wind" }), "wind");
});

test("autostart: the mode starts on a gesture, off never does, tests stay silent", () => {
  assert.equal(autostartChoice(null, false), DEFAULT_SCAPE);
  assert.equal(autostartChoice({ choice: "orbit", volume: 0.5, last: "orbit" }, false), "orbit");
  assert.equal(autostartChoice({ choice: "off", volume: 0.5, last: "orbit" }, false), null);
  assert.equal(autostartChoice(null, true), null);
  assert.equal(autostartChoice({ choice: "wind", volume: 0.5, last: "wind" }, true), null);
});
