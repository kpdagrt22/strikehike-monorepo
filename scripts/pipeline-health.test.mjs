import assert from "node:assert/strict";
import test from "node:test";
import { evaluate } from "./pipeline-health.mjs";

const NOW = new Date("2026-11-15T12:00:00Z");
const run = (hoursAgo, conclusion = "success") => ({
  created_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
  conclusion,
});

test("a recent successful run passes", () => {
  assert.equal(evaluate([run(2)], NOW, 24, 6).ok, true);
});

test("a stale run fails outside the window", () => {
  assert.equal(evaluate([run(31)], NOW, 24, 6).ok, false);
});

test("a recent failure fails", () => {
  assert.equal(evaluate([run(2, "failure")], NOW, 24, 6).ok, false);
});

test("in-progress runs are ignored in favour of the newest completed run", () => {
  const running = { created_at: NOW.toISOString(), conclusion: null };
  assert.equal(evaluate([running, run(2)], NOW, 24, 6).ok, true);
});

test("no completed run fails", () => {
  assert.equal(evaluate([], NOW, 24, 6).ok, false);
  assert.equal(
    evaluate([{ created_at: NOW.toISOString(), conclusion: null }], NOW, 24, 6).ok,
    false,
  );
});

test("a workflow too new to have run is not due yet", () => {
  const added = new Date(NOW.getTime() - 20 * 3_600_000).toISOString();
  const result = evaluate([], NOW, 168, 24, added);
  assert.equal(result.ok, true);
  assert.match(result.detail, /not due yet/);
});

test("a workflow older than its window with no scheduled run fails", () => {
  const added = new Date(NOW.getTime() - 200 * 3_600_000).toISOString();
  assert.equal(evaluate([], NOW, 168, 24, added).ok, false);
});

test("the window includes its grace edge", () => {
  assert.equal(evaluate([run(30)], NOW, 24, 6).ok, true);
  assert.equal(evaluate([run(30.1)], NOW, 24, 6).ok, false);
});
