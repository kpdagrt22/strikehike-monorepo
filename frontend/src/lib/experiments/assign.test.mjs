import assert from "node:assert/strict";
import test from "node:test";

import { EXPERIMENTS, experimentById } from "./config.ts";
import {
  parseOverride,
  pickVariant,
  resolveExperiment,
  resolveIn,
  stableHash,
  variantIndex,
} from "./assign.ts";

const WEIGHTS = [0.5, 0.5];

// A tiny deterministic generator (splitmix32), so the split is reproducible in
// CI. The low bits of a plain LCG repeat quickly, which would make the ids — and
// the hash test — meaningless.
function ids(count) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let state = 0x2f6e2b1;
  const next = () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
  const out = [];
  for (let i = 0; i < count; i += 1) {
    let id = "";
    for (let c = 0; c < 22; c += 1) {
      id += alphabet[next() % alphabet.length];
    }
    out.push(id);
  }
  return out;
}

test("10,000 ids split 50/50 within two percent", () => {
  const counts = [0, 0];
  for (const id of ids(10_000)) {
    counts[variantIndex("home-cta", id, WEIGHTS)] += 1;
  }
  const share = counts[0] / 10_000;
  assert.ok(
    share >= 0.48 && share <= 0.52,
    `control share ${share} outside 0.48-0.52 (counts ${counts[0]}/${counts[1]})`,
  );
  assert.equal(counts[0] + counts[1], 10_000);
});

test("the same id and experiment always give the same variant", () => {
  for (const id of ids(200)) {
    const first = variantIndex("home-cta", id, WEIGHTS);
    const second = variantIndex("home-cta", id, WEIGHTS);
    assert.equal(first, second);
    assert.equal(stableHash(`${id}|home-cta`), stableHash(`${id}|home-cta`));
  }
});

test("the hash is spread across the whole 32-bit range", () => {
  const seen = new Set();
  for (const id of ids(2_000)) {
    const hash = stableHash(id);
    assert.ok(hash >= 0 && hash <= 0xffffffff);
    seen.add(hash);
  }
  assert.equal(seen.size, 2_000);
});

test("weights steer the split", () => {
  const counts = [0, 0, 0];
  // 90 / 10 / 0: the third bucket never wins.
  for (const id of ids(5_000)) {
    counts[pickVariant(stableHash(`${id}|x`), [0.9, 0.1, 0])] += 1;
  }
  assert.equal(counts[2], 0);
  assert.ok(counts[0] > counts[1], `expected 0.9 to win: ${counts}`);
});

test("the shipped experiment is defined and not active", () => {
  const shipped = experimentById("home-cta");
  assert.ok(shipped);
  assert.equal(shipped.active, false);
  assert.deepEqual(shipped.variants, ["control", "record"]);
  assert.deepEqual(shipped.weights, [0.5, 0.5]);
  assert.ok(EXPERIMENTS.every((experiment) => experiment.active === false));
});

test("an inactive experiment serves control and reports nothing", () => {
  const id = "A".repeat(22);
  const off = resolveIn(EXPERIMENTS, "home-cta", id, null);
  assert.equal(off.variant, "control");
  assert.equal(off.isControl, true);
  assert.equal(off.track, false);
});

test("an active experiment with no anonymous id falls back to control", () => {
  const active = {
    id: "home-cta",
    variants: ["control", "record"],
    weights: WEIGHTS,
    active: true,
    surfaces: ["home"],
  };
  const fallback = resolveExperiment(active, null, null);
  assert.equal(fallback.variant, "control");
  assert.equal(fallback.track, false);
  const assigned = resolveExperiment(active, "A".repeat(22), null);
  assert.ok(["control", "record"].includes(assigned.variant));
  assert.equal(assigned.track, true);
});

test("an ?exp override wins and is reported", () => {
  const override = parseOverride("home-cta:record");
  assert.deepEqual(override, { id: "home-cta", variant: "record" });
  const forced = resolveIn(EXPERIMENTS, "home-cta", null, override);
  assert.equal(forced.variant, "record");
  assert.equal(forced.isControl, false);
  assert.equal(forced.track, true);
  // An override for a different experiment does not apply.
  const other = resolveIn(EXPERIMENTS, "home-cta", null, parseOverride("other:record"));
  assert.equal(other.variant, "control");
  // A malformed override is dropped.
  assert.equal(parseOverride("home-cta"), null);
  assert.equal(parseOverride(":record"), null);
  assert.equal(parseOverride("home-cta:Bad Variant"), null);
  assert.equal(parseOverride(null), null);
});
