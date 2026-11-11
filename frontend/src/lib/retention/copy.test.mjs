import assert from "node:assert/strict";
import test from "node:test";
import { newDatesSentence } from "./copy.ts";

test("change-note counts start with a word for one through nine", () => {
  assert.equal(newDatesSentence(0, false), "No new dates were added across all themes.");
  assert.equal(newDatesSentence(1, false), "One new date was added across all themes.");
  assert.equal(newDatesSentence(2, false), "Two new dates were added across all themes.");
  assert.equal(newDatesSentence(12, false), "12 new dates were added across all themes.");
});

test("change-note counts use the followed scope and correct number", () => {
  assert.equal(newDatesSentence(0, true), "No new dates were added in your themes.");
  assert.equal(newDatesSentence(1, true), "One new date was added in your themes.");
  assert.equal(newDatesSentence(2, true), "Two new dates were added in your themes.");
  assert.equal(newDatesSentence(9, true), "Nine new dates were added in your themes.");
});
