// UX-05 baseline: LCP, FCP, JS weight, atlas request and long tasks.
// Usage: node scripts/measure-regime.mjs
// Runs against a local prod build (http://127.0.0.1:3000).
import { chromium } from "@playwright/test";

const BASE = process.env.MEASURE_BASE ?? "http://127.0.0.1:3000";
const RUNS = 3;
const FAST_3G = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  connectionType: "cellular3g",
};

const INIT = () => {
  window.__m = { lcp: null, cls: 0, long: [] };
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) {
        window.__m.lcp = {
          time: last.startTime,
          element: last.element ?? null,
          url: last.url ?? "",
        };
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // No LCP support.
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__m.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // No CLS support.
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__m.long.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // No long-task support.
  }
};

async function measure(page) {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2_500);
  return page.evaluate(() => {
    const resources = performance.getEntriesByType("resource");
    const js = resources
      .filter(
        (entry) =>
          entry.initiatorType === "script" ||
          /\.js(\?|$)/.test(entry.name),
      )
      .reduce((sum, entry) => sum + (entry.transferSize || 0), 0);
    const atlas = resources
      .filter((entry) => entry.name.includes("/api/v1/regime/macro-history"))
      .map((entry) => ({
        url: entry.name.replace(location.origin, ""),
        bytes: entry.transferSize || 0,
        ms: Math.round(entry.duration),
      }));
    const fcp =
      performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
    const lcp = window.__m.lcp;
    const long = window.__m.long;
    const beforeLcp = lcp
      ? long.filter((entry) => entry.start < lcp.time)
      : long;
    return {
      fcp: fcp == null ? null : Math.round(fcp),
      lcp: lcp ? Math.round(lcp.time) : null,
      lcpElement: lcp ? window.__selectorOf(lcp.element) : "",
      lcpUrl: lcp?.url ?? "",
      jsBytes: js,
      atlas,
      longCount: long.length,
      longMs: Math.round(long.reduce((sum, entry) => sum + entry.duration, 0)),
      longBeforeLcpCount: beforeLcp.length,
      longBeforeLcpMs: Math.round(
        beforeLcp.reduce((sum, entry) => sum + entry.duration, 0),
      ),
      longBeforeLcpMax: Math.round(
        beforeLcp.reduce((max, entry) => Math.max(max, entry.duration), 0),
      ),
      cls: Number(window.__m.cls.toFixed(4)),
    };
  });
}

async function run(browser, path, width, height, throttled) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.clearBrowserCache");
  if (throttled) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.emulateNetworkConditions", FAST_3G);
  }
  await page.addInitScript(INIT);
  await page.addInitScript(() => {
    window.__selectorOf = (element) => {
      if (!element) return "";
      if (element.id) return `#${element.id}`;
      const parts = [];
      let node = element;
      while (node && node.nodeType === 1 && parts.length < 4) {
        let part = node.tagName.toLowerCase();
        const className =
          typeof node.className === "string" ? node.className.trim() : "";
        if (className) {
          part += `.${className.split(/\s+/).slice(0, 2).join(".")}`;
        }
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(" > ");
    };
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "load" });
  const result = await measure(page);
  await context.close();
  return result;
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

async function summarize(browser, path, width, height, throttled) {
  const runs = [];
  for (let index = 0; index < RUNS; index += 1) {
    runs.push(await run(browser, path, width, height, throttled));
  }
  const pick = (key) => median(runs.map((entry) => entry[key]));
  return {
    path,
    viewport: `${width}x${height}`,
    throttled,
    runs,
    median: {
      fcp: pick("fcp"),
      lcp: pick("lcp"),
      lcpElement: runs.find((entry) => entry.lcp === pick("lcp"))?.lcpElement ?? "",
      jsBytes: pick("jsBytes"),
      atlasBytes: median(runs.flatMap((entry) => entry.atlas.map((item) => item.bytes))),
      atlasMs: median(runs.flatMap((entry) => entry.atlas.map((item) => item.ms))),
      longBeforeLcpCount: pick("longBeforeLcpCount"),
      longBeforeLcpMs: pick("longBeforeLcpMs"),
      longBeforeLcpMax: pick("longBeforeLcpMax"),
      cls: pick("cls"),
    },
  };
}

const browser = await chromium.launch();
const rows = [];
for (const path of ["/regime", "/", "/upcoming"]) {
  rows.push(await summarize(browser, path, 390, 844, true));
}
rows.push(await summarize(browser, "/regime", 1366, 768, false));
await browser.close();

console.log("measure-regime (median of 3, cold cache)");
for (const row of rows) {
  console.log(JSON.stringify(row));
}
