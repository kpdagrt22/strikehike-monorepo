import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { mockHomeData } from "./fixtures/homeData";

// The fire's cost on the settled home page at 4x CPU throttling: score 99
// (tier 3, the most elements and animations) against score 50 (no fire).
//   long tasks: PerformanceObserver, 10 s, no tracing overhead
//   per frame:  a Chromium trace, main-thread busy time added by the fire,
//               divided by 60 frames per second
// Opt-in, because shared CI runners make timings noisy:
//   GAUGE_PERF=1 npx playwright test tests/gauge-perf.spec.ts
// It writes smoke-screens/gauge-perf.json and prints the numbers.

test.skip(!process.env.GAUGE_PERF, "set GAUGE_PERF=1 to measure the fire's cost");

const SETTLE_MS = 14_000; // the orrery sleeps 12 s after its last intent
const LONG_TASK_MS = 10_000;
const TRACE_MS = 4_000;
const CATEGORIES = ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline"];

type TraceEvent = {
  name: string;
  ph: string;
  pid: number;
  tid: number;
  dur?: number;
  args?: { name?: string };
};

async function openSettled(page: Page, score: number) {
  await page.addInitScript(() => {
    localStorage.setItem("strikehike-theme", "dark");
    localStorage.setItem("hasSeenIntro", "1");
    localStorage.setItem("strikehike:home:archive-open", "0");
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockHomeData(page, { score });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("[data-gauge-number]")).toHaveText(String(score));
  if (score >= 85) await expect(page.locator(".sh-aura")).toBeVisible();
  await page.waitForTimeout(SETTLE_MS);
}

async function measure(page: Page, score: number) {
  await openSettled(page, score);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // 1. Long tasks, measured in the page (no tracing overhead).
  const longTasks = await page.evaluate(
    (ms) =>
      new Promise<{ count: number; totalMs: number; longestMs: number }>((resolve) => {
        const entries: number[] = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) entries.push(entry.duration);
        });
        observer.observe({ type: "longtask", buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve({
            count: entries.length,
            totalMs: Math.round(entries.reduce((sum, value) => sum + value, 0)),
            longestMs: Math.round(Math.max(0, ...entries)),
          });
        }, ms);
      }),
    LONG_TASK_MS,
  );

  // 2. Main-thread busy time from a trace, per second of wall clock.
  const browser = page.context().browser()!;
  await browser.startTracing(page, { categories: CATEGORIES });
  await page.waitForTimeout(TRACE_MS);
  const buffer = await browser.stopTracing();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const events: TraceEvent[] = JSON.parse(buffer.toString()).traceEvents;
  const main = events
    .filter((event) => event.name === "thread_name" && event.args?.name === "CrRendererMain")
    .map((event) => ({
      event,
      count: events.filter((other) => other.pid === event.pid && other.tid === event.tid).length,
    }))
    .sort((left, right) => right.count - left.count)[0].event;
  const on = events.filter(
    (event) => event.pid === main.pid && event.tid === main.tid && event.ph === "X",
  );
  const total = (name: string) =>
    on.filter((event) => event.name === name).reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000;
  const busy = total("RunTask");
  return {
    score,
    longTasks,
    mainBusyMsPerSecond: Number((busy / (TRACE_MS / 1000)).toFixed(1)),
    styleMsPerSecond: Number((total("UpdateLayoutTree") / (TRACE_MS / 1000)).toFixed(1)),
    prePaintMsPerSecond: Number((total("PrePaint") / (TRACE_MS / 1000)).toFixed(1)),
  };
}

test("the fire adds no long tasks and under 4 ms of main-thread work per frame", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const results = [];
  for (const score of [50, 99]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      results.push(await measure(page, score));
    } finally {
      await context.close();
    }
  }
  const [without, withFire] = results;
  const addedPerSecond = withFire.mainBusyMsPerSecond - without.mainBusyMsPerSecond;
  const summary = {
    throttle: "4x CPU",
    longTaskWindowSeconds: LONG_TASK_MS / 1000,
    traceWindowSeconds: TRACE_MS / 1000,
    without,
    withFire,
    addedMainMsPerSecond: Number(addedPerSecond.toFixed(1)),
    // A frame at 60 fps: the per-frame figure this report quotes.
    addedMainMsPerFrame60: Number((addedPerSecond / 60).toFixed(2)),
    addedLongTasks: withFire.longTasks.count - without.longTasks.count,
  };
  console.log(JSON.stringify(summary, null, 2));
  mkdirSync("smoke-screens", { recursive: true });
  writeFileSync("smoke-screens/gauge-perf.json", JSON.stringify(summary, null, 2));
  expect(summary.addedLongTasks).toBeLessThanOrEqual(0);
  expect(summary.addedMainMsPerFrame60).toBeLessThan(4);
});
