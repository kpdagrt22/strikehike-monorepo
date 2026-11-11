import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOSTART_FIRST_VISIT,
  DEFAULT_SCAPE,
  DEFAULT_VOLUME,
  autostartChoice,
  parsePrefs,
} from "./scapes.ts";

test("nothing saved, or junk saved, reads as a first visit", () => {
  for (const raw of [null, "", "{", "[]", '{"choice":"jazz"}', "null"]) {
    assert.equal(parsePrefs(raw), null, String(raw));
  }
});

test("a saved choice keeps its scape and clamps the volume", () => {
  assert.deepEqual(parsePrefs('{"choice":"orbit","volume":0.3}'), {
    choice: "orbit",
    volume: 0.3,
  });
  assert.deepEqual(parsePrefs('{"choice":"off","volume":7}'), {
    choice: "off",
    volume: 1,
  });
  assert.deepEqual(parsePrefs('{"choice":"wind"}'), {
    choice: "wind",
    volume: DEFAULT_VOLUME,
  });
});

test("autostart: a first visit gets the default, off stays off, tests stay silent", () => {
  assert.equal(
    autostartChoice(null, false),
    AUTOSTART_FIRST_VISIT ? DEFAULT_SCAPE : null,
  );
  assert.equal(autostartChoice({ choice: "orbit", volume: 0.5 }, false), "orbit");
  assert.equal(autostartChoice({ choice: "off", volume: 0.5 }, false), null);
  assert.equal(autostartChoice(null, true), null);
  assert.equal(autostartChoice({ choice: "wind", volume: 0.5 }, true), null);
});
