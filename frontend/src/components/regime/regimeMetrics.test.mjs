import assert from "node:assert/strict";
import test from "node:test";

import { buildCrashMetrics } from "./regimeMetrics.js";

const crash = { id: "x", name: "Test window", start: "2020-01-01", end: "2020-12-31" };
const points = (values) =>
  values.map(([date, value]) => ({ date, sp500_proxy: value, core_index: 0 }));

test("the drawdown only pairs a peak with a later low", () => {
  // Old max/min pairing: 120 peak vs 70 low = -41.7%.
  // Running peak: 100 -> 70 = -30%; 120 -> 110 = -8.3%.
  const metrics = buildCrashMetrics(
    points([
      ["2020-01-01", 100],
      ["2020-02-01", 70],
      ["2020-03-01", 120],
      ["2020-04-01", 110],
    ]),
    [crash],
  );
  assert.equal(metrics[0].drawdown.toFixed(1), "-30.0");
  assert.equal(metrics[0].peak_date, "2020-01-01");
  assert.equal(metrics[0].trough_date, "2020-02-01");
});

test("a low before the high is never counted against that high", () => {
  // Old max/min pairing would read 110 and 70 as -36.4%, though no fall
  // happened after 110.
  const metrics = buildCrashMetrics(
    points([
      ["2020-01-01", 100],
      ["2020-02-01", 70],
      ["2020-03-01", 110],
    ]),
    [crash],
  );
  assert.equal(metrics[0].drawdown.toFixed(1), "-30.0");
  assert.equal(metrics[0].trough_date, "2020-02-01");
});

test("the largest later fall wins, and the Core Index low is kept", () => {
  const metrics = buildCrashMetrics(
    [
      { date: "2020-01-01", sp500_proxy: 100, core_index: 12 },
      { date: "2020-02-01", sp500_proxy: 95, core_index: -4 },
      { date: "2020-03-01", sp500_proxy: 120, core_index: -18 },
      { date: "2020-04-01", sp500_proxy: 90, core_index: -30 },
    ],
    [crash],
  );
  assert.equal(metrics[0].drawdown.toFixed(1), "-25.0");
  assert.equal(metrics[0].score, -30);
  assert.equal(metrics[0].trough_date, "2020-04-01");
});
