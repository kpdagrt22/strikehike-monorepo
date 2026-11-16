#!/usr/bin/env node
// TBT-4: which React components the home page's main-thread time goes to.
//
// Needs a build made with `next build --profile`: React's profiling build
// writes every component render to the "Components ⚛" performance track
// (console.timeStamp). This script loads a page in Chromium with phone
// emulation and a CPU throttle, records a DevTools trace, and joins the two:
//
// - long tasks: main-thread RunTask events over 50 ms (their time over 50 ms is
//   what Total Blocking Time adds up);
// - components: each track entry's self time (its span minus the spans of the
//   components inside it), summed by component name, overall and inside long
//   tasks only.
//
// Usage (from frontend/):
//   node scripts/react-tracks.mjs --url=http://127.0.0.1:3413/ --runs=3 --cpu=4 \
//     --out=react-tracks.json
//
// Measurement only: nothing here ships, and the numbers are relative (a shared
// machine, a throttled CPU), for ranking components, not for absolute claims.

import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const url = arg("url", "http://127.0.0.1:3000/");
const runs = Math.max(1, Number(arg("runs", "3")) || 3);
const cpu = Math.max(1, Number(arg("cpu", "4")) || 4);
const settleMs = Math.max(0, Number(arg("settle", "6000")) || 6000);
const outPath = arg("out", "");
const TRACK = "Components ⚛";
const LONG_TASK_MS = 50;

async function traceOnce() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    // React's profiling build times components only on a root in profile
    // mode, which it sets when it sees the DevTools hook (createFiberRoot:
    // `isDevToolsPresent && (tag |= 2)`). A no-op hook turns that on; without
    // it the track carries only "Blocked" entries, which is what TBT-3 saw.
    await context.addInitScript(() => {
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        isDisabled: false,
        renderers: new Map(),
        inject: () => 1,
        checkDCE: () => {},
        onCommitFiberRoot: () => {},
        onCommitFiberUnmount: () => {},
        onPostCommitFiberRoot: () => {},
      };
    });
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    const events = [];
    session.on("Tracing.dataCollected", ({ value }) => events.push(...value));
    const complete = new Promise((resolve) => session.once("Tracing.tracingComplete", resolve));
    await session.send("Tracing.start", {
      categories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "toplevel",
        "v8.execute",
        "blink.user_timing",
        "__metadata",
      ].join(","),
      transferMode: "ReportEvents",
    });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(settleMs);
    await session.send("Tracing.end");
    await complete;
    await context.close();
    return events;
  } finally {
    await browser.close();
  }
}

function mainThread(events) {
  const names = events.filter((event) => event.ph === "M" && event.name === "thread_name");
  const main = names.filter((event) => event.args?.name === "CrRendererMain");
  // The page's renderer is the one whose main thread ran the most tasks.
  let best = null;
  let bestCount = -1;
  for (const thread of main) {
    const count = events.filter(
      (event) => event.pid === thread.pid && event.tid === thread.tid && event.name === "RunTask",
    ).length;
    if (count > bestCount) {
      best = thread;
      bestCount = count;
    }
  }
  return best ? { pid: best.pid, tid: best.tid } : null;
}

function componentSpans(events, thread) {
  const spans = [];
  for (const event of events) {
    if (event.name !== "TimeStamp" || event.pid !== thread.pid) continue;
    const data = event.args?.data ?? {};
    if (data.track !== TRACK) continue;
    const start = Number(data.start);
    const end = Number(data.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    // Chrome records start/end on the trace clock (µs), like ts.
    // React colours a render primary/tertiary (tertiary: hydrated) and an
    // effect secondary (logComponentRender / logComponentEffect).
    const kind = String(data.color ?? "").startsWith("secondary") ? "effect" : "render";
    spans.push({ name: String(data.message ?? data.name ?? "?"), kind, start, end });
  }
  // Self time, per kind: a span minus the spans of the same kind directly inside it.
  for (const kind of ["render", "effect"]) {
    const ofKind = spans
      .filter((span) => span.kind === kind)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const stack = [];
    for (const span of ofKind) {
      span.self = span.end - span.start;
      while (stack.length && stack.at(-1).end <= span.start) stack.pop();
      const parent = stack.at(-1);
      if (parent && span.end <= parent.end) parent.self -= span.end - span.start;
      stack.push(span);
    }
  }
  return spans;
}

function analyse(events) {
  const thread = mainThread(events);
  if (!thread) throw new Error("no renderer main thread in the trace");
  const tasks = events
    .filter((event) => event.pid === thread.pid && event.tid === thread.tid && event.name === "RunTask" && event.dur)
    .map((event) => ({ start: event.ts, end: event.ts + event.dur, ms: event.dur / 1000 }));
  const longTasks = tasks.filter((task) => task.ms > LONG_TASK_MS);
  const spans = componentSpans(events, thread);
  const inLong = (span) => longTasks.some((task) => span.start >= task.start && span.end <= task.end + 1000);
  const byName = new Map();
  for (const span of spans) {
    const key = `${span.name} [${span.kind}]`;
    const row = byName.get(key) ?? { name: key, count: 0, self_ms: 0, self_in_long_ms: 0 };
    row.count += 1;
    row.self_ms += span.self / 1000;
    if (inLong(span)) row.self_in_long_ms += span.self / 1000;
    byName.set(key, row);
  }
  return {
    long_tasks: longTasks.map((task) => Math.round(task.ms)),
    blocking_ms: Math.round(longTasks.reduce((sum, task) => sum + task.ms - LONG_TASK_MS, 0)),
    component_spans: spans.length,
    components_self_ms: Math.round(spans.reduce((sum, span) => sum + span.self, 0) / 1000),
    components: [...byName.values()].sort((a, b) => b.self_ms - a.self_ms),
  };
}

const results = [];
for (let run = 0; run < runs; run += 1) {
  const events = await traceOnce();
  results.push(analyse(events));
  const last = results.at(-1);
  console.log(
    `run ${run + 1}: long tasks ${last.long_tasks.join(", ")} ms; blocking ${last.blocking_ms} ms; ` +
      `${last.component_spans} component spans, ${last.components_self_ms} ms self`,
  );
}

// Median self time per component across runs.
const names = new Set(results.flatMap((result) => result.components.map((row) => row.name)));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const table = [...names]
  .map((name) => {
    const rows = results.map((result) => result.components.find((row) => row.name === name));
    return {
      name,
      count: median(rows.map((row) => row?.count ?? 0)),
      self_ms: Number(median(rows.map((row) => row?.self_ms ?? 0)).toFixed(1)),
      self_in_long_ms: Number(median(rows.map((row) => row?.self_in_long_ms ?? 0)).toFixed(1)),
    };
  })
  .sort((a, b) => b.self_ms - a.self_ms);

console.log("\ncomponent (median of runs)        self ms   in long tasks   renders");
for (const row of table.slice(0, 25)) {
  console.log(
    `${row.name.padEnd(32).slice(0, 32)} ${String(row.self_ms).padStart(8)} ${String(row.self_in_long_ms).padStart(15)} ${String(row.count).padStart(9)}`,
  );
}
if (outPath) {
  writeFileSync(outPath, `${JSON.stringify({ url, runs, cpu, results, table }, null, 2)}\n`);
}
