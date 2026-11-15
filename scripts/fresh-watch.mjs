#!/usr/bin/env node
// FRESH-watch: daily public freshness check against production.
//
//   node scripts/fresh-watch.mjs --base-url=https://strikehike.com --summary=fresh-watch.md
//
// Every check prints its threshold and today's value. A crossed threshold
// exits 1 (the workflow goes red and GitHub emails the owner); a network error
// is retried three times before it counts.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const THRESHOLDS = {
  regimeDays: 9,
  roundupDays: 8,
  bundleDays: 8,
  sitemapDays: 8,
};

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

export function todayIst(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isoWeekMonday(week) {
  const match = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const number = Number(match[2]);
  if (number < 1 || number > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekday = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - weekday + 1 + (number - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

export function daysOld(today, isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate ?? "")) return null;
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

function row(name, threshold, value, ok) {
  return { name, threshold, value, ok };
}

export function evaluate(input) {
  const {
    today,
    regimeAsOf,
    roundupWeek,
    bundleCreatedAt,
    healthStatus,
    sitemapStatus,
    thisWeekLastmod,
  } = input;
  const rows = [];

  const regimeAge = daysOld(today, regimeAsOf);
  rows.push(
    row(
      "Newest Regime reading",
      `≤ ${THRESHOLDS.regimeDays} days`,
      regimeAsOf ? `${regimeAsOf} (${regimeAge} d)` : "missing",
      regimeAge !== null && regimeAge <= THRESHOLDS.regimeDays,
    ),
  );

  const monday = roundupWeek ? isoWeekMonday(roundupWeek) : null;
  const roundupAge = monday ? daysOld(today, monday) : null;
  rows.push(
    row(
      "Newest approved roundup week",
      `Monday ≤ ${THRESHOLDS.roundupDays} days old`,
      monday ? `${roundupWeek} starts ${monday} (${roundupAge} d)` : "missing",
      roundupAge !== null && roundupAge <= THRESHOLDS.roundupDays,
    ),
  );

  const bundleAge = daysOld(today, (bundleCreatedAt ?? "").slice(0, 10));
  rows.push(
    row(
      "Events bundle generated",
      `≤ ${THRESHOLDS.bundleDays} days`,
      bundleCreatedAt ? `${bundleCreatedAt.slice(0, 10)} (${bundleAge} d)` : "missing",
      bundleAge !== null && bundleAge <= THRESHOLDS.bundleDays,
    ),
  );

  rows.push(
    row(
      "Health route",
      "HTTP 200",
      String(healthStatus ?? "no answer"),
      healthStatus === 200,
    ),
  );
  rows.push(
    row(
      "Sitemap",
      "HTTP 200",
      String(sitemapStatus ?? "no answer"),
      sitemapStatus === 200,
    ),
  );

  const lastmodAge = daysOld(today, thisWeekLastmod);
  rows.push(
    row(
      "`/this-week` sitemap lastmod",
      `≤ ${THRESHOLDS.sitemapDays} days`,
      thisWeekLastmod ? `${thisWeekLastmod} (${lastmodAge} d)` : "missing",
      lastmodAge !== null && lastmodAge <= THRESHOLDS.sitemapDays,
    ),
  );

  return rows;
}

export function markdown(rows, baseUrl, today) {
  const lines = [
    `## FRESH-watch · ${baseUrl} · ${today} (IST)`,
    "",
    "| Check | Threshold | Today | Result |",
    "|---|---|---|---|",
  ];
  for (const item of rows) {
    lines.push(
      `| ${item.name} | ${item.threshold} | ${item.value} | ${item.ok ? "PASS" : "**FAIL**"} |`,
    );
  }
  lines.push("");
  lines.push(
    `Overall: **${rows.every((item) => item.ok) ? "PASS" : "FAIL"}**`,
  );
  return `${lines.join("\n")}\n`;
}

async function get(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, {
        headers: { "User-Agent": "StrikeHike-fresh-watch/1.0" },
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
      }
    }
  }
  throw lastError;
}

async function collect(baseUrl) {
  const today = todayIst();
  const monthAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000);
  const regimeUrl = `${baseUrl}/api/v1/regime/macro-history?resolution=weekly&start=${monthAgo
    .toISOString()
    .slice(0, 10)}`;

  const [regimeResponse, roundupResponse, healthResponse, sitemapResponse] =
    await Promise.all([
      get(regimeUrl),
      get(`${baseUrl}/this-week/latest.json`),
      get(`${baseUrl}/api/v1/events/health`),
      get(`${baseUrl}/sitemap.xml`),
    ]);

  const regime = regimeResponse.ok ? await regimeResponse.json() : {};
  const roundup = roundupResponse.ok ? await roundupResponse.json() : {};
  const health = healthResponse.ok ? await healthResponse.json() : {};
  const sitemap = sitemapResponse.ok ? await sitemapResponse.text() : "";

  const match = sitemap.match(
    /<loc>https:\/\/strikehike\.com\/this-week<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/,
  );

  return {
    today,
    input: {
      today,
      regimeAsOf: regime.as_of,
      roundupWeek: roundup.week,
      bundleCreatedAt: health.created_at,
      healthStatus: healthResponse.status,
      sitemapStatus: sitemapResponse.status,
      thisWeekLastmod: match?.[1]?.trim(),
    },
  };
}

export async function main() {
  const baseUrl = arg("base-url", "https://strikehike.com").replace(/\/+$/, "");
  const summary = arg("summary", "");
  const { today, input } = await collect(baseUrl);
  const rows = evaluate(input);
  const text = markdown(rows, baseUrl, today);
  process.stdout.write(text);
  if (summary) writeFileSync(summary, text, "utf8");
  if (!rows.every((item) => item.ok)) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
