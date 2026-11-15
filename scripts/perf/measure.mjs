#!/usr/bin/env node
// PERF-CI: run Lighthouse N times per route and report medians.
//
// Usage:
//   node scripts/perf/measure.mjs --base-url=https://strikehike.com --runs=5 \
//     --form-factor=mobile --out=perf-measure.json --markdown=perf-measure.md
//
// Lighthouse is fetched with npx at the pinned version; it is never added to
// package.json or the runtime image. The route list is fixed except for one
// live /events/<id>, which is picked from /upcoming on every run.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIGHTHOUSE = "lighthouse@13.6.0";
const DEFAULT_ROUTES = [
  "/",
  "/disclaimer",
  "/about",
  "/regime",
  "/upcoming",
  "/convergence",
  "/tested/full-moon",
  "/this-week",
];

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const baseUrl = arg("base-url", "https://strikehike.com").replace(/\/+$/, "");
const runs = Math.max(1, Number(arg("runs", "5")) || 5);
const formFactor = arg("form-factor", "mobile") === "desktop" ? "desktop" : "mobile";
const outPath = arg("out", "perf-measure.json");
const markdownPath = arg("markdown", "perf-measure.md");
const extraRoutes = arg("routes", "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

async function liveEventRoute() {
  const response = await fetch(`${baseUrl}/upcoming`, {
    headers: { "User-Agent": "StrikeHike-perf-measure/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`/upcoming answered ${response.status}`);
  }
  const html = await response.text();
  const match = html.match(/href="(\/events\/[^"]+)"/);
  if (!match) throw new Error("no /events/<id> link on /upcoming");
  return match[1];
}

function runLighthouse(url, index) {
  const dir = mkdtempSync(join(tmpdir(), "perf-ci-"));
  const file = join(dir, `lh-${index}.json`);
  const flags = [
    `npx --yes ${LIGHTHOUSE}`,
    quote(url),
    "--output=json",
    `--output-path=${quote(file)}`,
    "--only-categories=performance",
    `--form-factor=${formFactor}`,
    "--throttling-method=simulate",
    formFactor === "mobile"
      ? "--screenEmulation.mobile --screenEmulation.width=390 --screenEmulation.height=844 --screenEmulation.deviceScaleFactor=3"
      : "--screenEmulation.mobile=false --screenEmulation.width=1350 --screenEmulation.height=940 --screenEmulation.deviceScaleFactor=1",
    '--chrome-flags="--headless=new --no-sandbox --disable-gpu"',
    "--quiet",
  ].join(" ");
  const result = spawnSync(flags, {
    shell: true,
    encoding: "utf8",
    timeout: 240_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `lighthouse failed for ${url} (exit ${result.status}): ${(result.stderr || result.stdout || "").slice(-800)}`,
    );
  }
  const report = JSON.parse(readFileSync(file, "utf8"));
  const audit = (name) => report.audits?.[name]?.numericValue ?? 0;
  const scriptBytes = (report.audits?.["network-requests"]?.details?.items ?? [])
    .filter((item) => item.resourceType === "Script")
    .reduce((sum, item) => sum + (item.transferSize || 0), 0);
  return {
    performance: Math.round((report.categories?.performance?.score ?? 0) * 100),
    lcp_ms: Math.round(audit("largest-contentful-paint")),
    tbt_ms: Math.round(audit("total-blocking-time")),
    cls: Number(audit("cumulative-layout-shift").toFixed(4)),
    fcp_ms: Math.round(audit("first-contentful-paint")),
    speed_index_ms: Math.round(audit("speed-index")),
    script_bytes: scriptBytes,
    benchmark_index: Math.round(report.environment?.benchmarkIndex ?? 0),
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianRow(runRows) {
  return {
    performance: median(runRows.map((row) => row.performance)),
    lcp_ms: median(runRows.map((row) => row.lcp_ms)),
    tbt_ms: median(runRows.map((row) => row.tbt_ms)),
    cls: median(runRows.map((row) => row.cls)),
    fcp_ms: median(runRows.map((row) => row.fcp_ms)),
    speed_index_ms: median(runRows.map((row) => row.speed_index_ms)),
    script_bytes: median(runRows.map((row) => row.script_bytes)),
    benchmark_index: median(runRows.map((row) => row.benchmark_index)),
  };
}

function table(data) {
  const lines = [
    `Base: ${data.base_url} · ${data.form_factor} · ${data.runs} run(s) per route · Lighthouse 13.6.0`,
    "",
    "| Route | Perf | LCP | TBT | CLS | FCP | Speed Index | Scripts | Benchmark |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of data.routes) {
    const m = row.median;
    lines.push(
      `| \`${row.route}\` | ${m.performance} | ${m.lcp_ms} ms | ${m.tbt_ms} ms | ${m.cls.toFixed(4)} | ${m.fcp_ms} ms | ${m.speed_index_ms} ms | ${m.script_bytes} B | ${m.benchmark_index} |`,
    );
  }
  lines.push("");
  lines.push(
    "Medians are descriptive. This job fails only when a Lighthouse run cannot complete.",
  );
  return `${lines.join("\n")}\n`;
}

const event = await liveEventRoute();
const routes = [...DEFAULT_ROUTES, event, ...extraRoutes];
const collected = [];
for (const [index, route] of routes.entries()) {
  const url = `${baseUrl}${route}`;
  const rows = [];
  for (let pass = 1; pass <= runs; pass += 1) {
    console.error(`[${index + 1}/${routes.length}] ${route} run ${pass}/${runs}`);
    rows.push(runLighthouse(url, `${index}-${pass}`));
  }
  collected.push({ route, url, median: medianRow(rows), runs: rows });
}

const data = {
  generated_at: new Date().toISOString(),
  base_url: baseUrl,
  form_factor: formFactor,
  lighthouse: LIGHTHOUSE,
  runs,
  event_route: event,
  routes: collected,
};
const markdown = table(data);
writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, markdown, "utf8");
console.log(markdown);
