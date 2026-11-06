import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AURA_BOX,
  EMBER_PATHS,
  EMBER_RISE,
  FACE_CLEARANCE,
  RING_OUTER,
  VARIANT_COUNT,
  auraTier,
  crown,
  flameClearance,
  flameMask,
} from "./crown.ts";

const GLOBALS = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

// GaugeAura.jsx: the aura div, the sway div, the glow div and its svg, defs,
// filter, blur, group, halo circle and path; then one element per tongue, one
// per sector, one per ember.
const FIXED_ELEMENTS = 10;
const MODES = ["full", "phone", "compact"];

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

test("no crown below 85", () => {
  for (const mode of MODES) assert.equal(crown(0, mode), null);
});

function base(tongue) {
  return [tongue.left + tongue.width / 2, tongue.top + tongue.height];
}

for (const mode of MODES) {
  for (const tier of [1, 2, 3]) {
    test(`${mode} tier ${tier}: within budget, outside the ring, clear of the face`, () => {
      const shape = crown(tier, mode);
      const centre = AURA_BOX[mode] / 2;
      const tongues = shape.sectors.flatMap((sector) => sector.tongues);
      assert.equal(shape.box, AURA_BOX[mode]);
      const elements = FIXED_ELEMENTS + tongues.length + shape.sectors.length + shape.embers.length;
      assert.ok(elements <= 60, `${elements} elements`);
      assert.ok(shape.animated <= 20, `${shape.animated} animated elements`);
      assert.equal(shape.embers.length > 0, tier === 3);
      assert.ok(
        shape.sectors.length > 0 && shape.sectors.length <= [0, 6, 8, 10][tier],
        `${shape.sectors.length} sectors`,
      );
      for (const tongue of tongues) {
        const [x, y] = base(tongue);
        assert.ok(Math.hypot(x - centre, y - centre) >= RING_OUTER, `${tongue.key} starts inside the ring`);
        assert.ok(
          flameClearance([x, y], tongue.width, tongue.height, tongue.lean, centre) >= FACE_CLEARANCE,
          `${tongue.key} box reaches the face`,
        );
        assert.ok(tongue.left >= 0 && tongue.top >= 0, `${tongue.key} leaves the box`);
        assert.ok(tongue.left + tongue.width <= shape.box && tongue.top + tongue.height <= shape.box);
      }
      for (const sector of shape.sectors) {
        assert.ok(sector.tongues.length > 0, `${sector.key} is empty`);
        assert.ok(sector.flicker >= 0.6 && sector.flicker <= 2.2, `${sector.key} loop ${sector.flicker}`);
        assert.ok(sector.delay <= 0);
        assert.ok(GLOBALS.includes("@keyframes sh-flame-flicker"));
        const origin = Math.hypot(sector.originX - centre, sector.originY - centre);
        assert.ok(Math.abs(origin - RING_OUTER) < 3, `${sector.key} turns about ${origin.toFixed(1)}px`);
      }
      for (const ember of shape.embers) {
        const drift = EMBER_PATHS[ember.path];
        assert.ok(ember.top - EMBER_RISE[mode] >= 0, `${ember.key} rises out of the box`);
        assert.ok(ember.left + drift >= 0 && ember.left + ember.size + drift <= shape.box);
        assert.ok(Math.hypot(ember.left - centre, ember.top - centre) > FACE_CLEARANCE);
      }
    });

    test(`${mode} tier ${tier}: tallest at the top, nothing past the shoulders`, () => {
      const shape = crown(tier, mode);
      const centre = AURA_BOX[mode] / 2;
      const tongues = shape.sectors.flatMap((sector) => sector.tongues);
      const tallest = Math.max(...tongues.map((tongue) => tongue.height));
      for (const tongue of tongues) {
        const [x, y] = base(tongue);
        const angle = Math.abs((Math.atan2(x - centre, centre - y) * 180) / Math.PI);
        assert.ok(angle <= 130, `${tongue.key} at ${angle.toFixed(0)}°`);
        if (angle > 90) assert.ok(tongue.height <= tallest * 0.35, `${tongue.key} is tall low down`);
      }
      const top = tongues.filter((tongue) => {
        const [x, y] = base(tongue);
        return Math.abs(Math.atan2(x - centre, centre - y)) < Math.PI / 6;
      });
      assert.ok(top.some((tongue) => tongue.height === tallest), "the tallest tongue is not near 12 o'clock");
    });
  }

  test(`${mode}: higher tiers are taller, denser and faster`, () => {
    const [one, two, three] = [1, 2, 3].map((tier) => crown(tier, mode));
    const tongues = (shape) => shape.sectors.flatMap((sector) => sector.tongues);
    const tallest = (shape) => Math.max(...tongues(shape).map((tongue) => tongue.height));
    const pace = (shape) =>
      shape.sectors.reduce((sum, sector) => sum + sector.flicker, 0) / shape.sectors.length;
    assert.ok(tallest(one) < tallest(two) && tallest(two) < tallest(three));
    assert.ok(tongues(one).length < tongues(two).length && tongues(two).length < tongues(three).length);
    assert.ok(pace(one) > pace(two) && pace(two) > pace(three));
    assert.ok(one.sway > two.sway && two.sway > three.sway);
  });
}

test("the crown is the same on every render", () => {
  assert.deepEqual(crown(3, "full"), crown(3, "full"));
});

test("flame masks are SVG data URLs, and globals.css carries each one", () => {
  for (let variant = 0; variant < VARIANT_COUNT; variant += 1) {
    for (const mirrored of [false, true]) {
      const mask = flameMask(variant, mirrored);
      assert.match(mask, /^url\("data:image\/svg\+xml,%3Csvg/);
      assert.ok(!mask.includes("#"));
      const index = variant + (mirrored ? VARIANT_COUNT : 0);
      assert.ok(
        GLOBALS.includes(`.sh-flame[data-v="${index}"] {\r\n  mask-image: ${mask},`) ||
          GLOBALS.includes(`.sh-flame[data-v="${index}"] {\n  mask-image: ${mask},`),
        `globals.css is out of date for data-v ${index}`,
      );
    }
  }
  assert.notEqual(flameMask(0, false), flameMask(0, true));
});

test("globals.css has a keyframe set for every ember path, at both sizes", () => {
  for (const [path, drift] of Object.entries(EMBER_PATHS)) {
    for (const [suffix, rise] of [["", EMBER_RISE.full], ["-c", EMBER_RISE.compact]]) {
      assert.ok(GLOBALS.includes(`@keyframes sh-ember-${path}${suffix} {`), `${path}${suffix}`);
      assert.ok(
        GLOBALS.includes(`transform: translate(${drift}px, ${-rise}px) scale(0.3);`),
        `${path}${suffix} end point`,
      );
    }
  }
});
