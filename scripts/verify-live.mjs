#!/usr/bin/env node
// LIVE-verify: prove a deploy from the outside.
//
//   node scripts/verify-live.mjs --base-url=https://strikehike.com --expect-sha=abc1234
//
// Read-only public GETs plus two deliberately invalid CSP POSTs (403 and 413).
// No valid report body is ever sent to production.

import { pathToFileURL } from "node:url";

const UA = "StrikeHike-live-verify/1.0 (+https://strikehike.com/about)";

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

export function scriptsFromHtml(html) {
  return [...new Set(
    [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((src) => src.startsWith("/_next/")),
  )];
}

export function hasThreeChunk(contents) {
  return contents.some(
    (text) => text.includes("WebGLRenderer") || text.includes("THREE.WebGLRenderer"),
  );
}

export function headerChecks(headers) {
  const value = (name) => headers.get(name) ?? "";
  return [
    { name: "HSTS", ok: value("strict-transport-security").includes("max-age="), value: value("strict-transport-security") },
    { name: "nosniff", ok: value("x-content-type-options") === "nosniff", value: value("x-content-type-options") },
    { name: "referrer", ok: Boolean(value("referrer-policy")), value: value("referrer-policy") },
    {
      name: "CSP report-only",
      ok: value("content-security-policy-report-only").includes("report-to"),
      value: value("content-security-policy-report-only").slice(0, 80),
    },
    {
      name: "Reporting-Endpoints",
      ok: value("reporting-endpoints").includes("csp-endpoint"),
      value: value("reporting-endpoints"),
    },
  ];
}

export function posterCheck(html, scriptContents) {
  const scripts = scriptsFromHtml(html);
  return {
    scripts: scripts.length,
    hasThree: hasThreeChunk(scriptContents),
    ok: scripts.length > 0 && !hasThreeChunk(scriptContents),
  };
}

async function get(base, path, options = {}, timeoutMs = 30_000) {
  return fetch(`${base}${path}`, {
    headers: { "User-Agent": UA, ...(options.headers ?? {}) },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    ...options,
  });
}

async function waitForVersion(base, expected, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const response = await get(base, "/version.json", {}, 10_000);
      if (response.ok) {
        last = (await response.json()).sha ?? "";
        if (last === expected) return true;
      } else {
        last = `HTTP ${response.status}`;
      }
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  console.error(`version mismatch: expected ${expected}, last saw ${last}`);
  return false;
}

async function main() {
  const base = arg("base-url", "https://strikehike.com").replace(/\/+$/, "");
  const expected = arg("expect-sha", "");
  const timeout = Number(arg("timeout", "120")) || 120;
  if (!expected) throw new Error("--expect-sha is required");

  const rows = [];
  const record = (name, ok, detail) => {
    rows.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  };

  record("version", await waitForVersion(base, expected, timeout), expected);

  const routes = ["/", "/regime", "/upcoming", "/convergence", "/this-week", "/tested", "/about", "/disclaimer"];
  for (const route of routes) {
    const response = await get(base, route);
    record(`route ${route}`, response.status === 200, String(response.status));
  }
  const unknown = `/live-verify-${Date.now()}`;
  const missing = await get(base, unknown);
  record("unknown path", missing.status === 404, String(missing.status));

  const home = await get(base, "/");
  const headers = headerChecks(home.headers);
  for (const item of headers) record(item.name, item.ok, item.value || "missing");

  const cross = await get(base, "/api/v1/csp-report", {
    method: "POST",
    headers: { Origin: "https://example.com", "Content-Type": "application/csp-report" },
    body: '{"x":1}',
  });
  record("CSP foreign origin", cross.status === 403, String(cross.status));
  const oversized = await get(base, "/api/v1/csp-report", {
    method: "POST",
    headers: { Origin: "https://example.com", "Content-Type": "application/csp-report" },
    body: "x".repeat(9_000),
  });
  record("CSP oversized body", oversized.status === 413, String(oversized.status));

  const phoneHtml = await (
    await get(base, "/", {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      },
    })
  ).text();
  const scripts = scriptsFromHtml(phoneHtml);
  const contents = await Promise.all(
    scripts.map(async (src) => {
      try {
        return await (await get(base, src)).text();
      } catch {
        return "";
      }
    }),
  );
  const poster = posterCheck(phoneHtml, contents);
  record(
    "poster has no three.js in initial scripts",
    poster.ok,
    `${poster.scripts} scripts, three=${poster.hasThree}`,
  );

  for (const path of ["/sitemap.xml", "/robots.txt", "/llms.txt"]) {
    const response = await get(base, path);
    record(path, response.status === 200, String(response.status));
  }

  const failed = rows.filter((row) => !row.ok);
  console.log(`live verify: ${rows.length - failed.length}/${rows.length} passed`);
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
