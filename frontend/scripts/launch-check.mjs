#!/usr/bin/env node
// Launch QA: run against any base URL (local prod build, a preview, or production).
//
//   node scripts/launch-check.mjs                       # http://127.0.0.1:3000
//   node scripts/launch-check.mjs https://strikehike.com
//   LAUNCH_BASE=https://strikehike.com node scripts/launch-check.mjs
//
// It reads /sitemap.xml, then checks every URL it lists:
//   - the page returns 200 (a 301/308 that lands on a 200 is accepted)
//   - <title>, meta description and <link rel="canonical"> are present
//   - og:image is present and the image itself returns 200 image/png
//   - every internal link on the page resolves (no 4xx/5xx)
//   - the page's JavaScript stays under 1 MB
// It also asserts the hidden routes are gone: /upcoming/politics,
// /upcoming/natural-disasters and /calendar/politics.ics must all 404.
//
// Needs the Playwright Chromium already installed for the smoke suite; no new
// dependency. Exit code 1 on any failure.

import { chromium } from "@playwright/test";

const BASE = (process.argv[2] ?? process.env.LAUNCH_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const JS_LIMIT = 1024 * 1024;
const EXPECT_404 = [
  "/upcoming/politics",
  "/upcoming/natural-disasters",
  "/calendar/politics.ics",
];

const failures = [];
const fail = (message) => failures.push(message);

/** A local path for a URL on the sitemap's own host, so a local run works. */
function localPath(raw) {
  try {
    return new URL(raw).pathname;
  } catch {
    return raw.startsWith("/") ? raw : `/${raw}`;
  }
}

async function get(url) {
  const response = await fetch(url, { redirect: "manual" });
  return response;
}

async function statusOf(path, { follow = true } = {}) {
  let response = await get(`${BASE}${path}`);
  if (follow && response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      response = await get(location.startsWith("http") ? location : `${BASE}${localPath(location)}`);
    }
  }
  return response;
}

function pick(html, pattern) {
  const match = pattern.exec(html);
  return match ? match[1].trim() : null;
}

function internalLinks(html) {
  const links = new Set();
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (href.startsWith("/") && !href.startsWith("//")) {
      links.add(href.split("#")[0].split("?")[0]);
    }
  }
  return [...links].filter(Boolean);
}

async function sitemapPaths() {
  const response = await statusOf("/sitemap.xml");
  if (response.status !== 200) {
    fail(`/sitemap.xml returned ${response.status}`);
    return [];
  }
  const xml = await response.text();
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => localPath(match[1]));
  return [...new Set(paths)];
}

async function checkHidden() {
  for (const path of EXPECT_404) {
    const response = await statusOf(path, { follow: false });
    if (response.status !== 404) {
      fail(`${path} should 404 but returned ${response.status}`);
    } else {
      console.log(`  ok   404   ${path}`);
    }
  }
}

async function checkPage(path, browser) {
  const response = await statusOf(path);
  if (response.status !== 200) {
    fail(`${path} returned ${response.status}`);
    return;
  }
  const html = await response.text();

  const title = pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!title) fail(`${path} has no <title>`);

  const description = pick(
    html,
    /<meta[^>]+name="description"[^>]+content="([^"]*)"/i,
  ) ?? pick(html, /<meta[^>]+content="([^"]*)"[^>]+name="description"/i);
  if (!description) fail(`${path} has no meta description`);

  const canonical = pick(
    html,
    /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i,
  ) ?? pick(html, /<link[^>]+href="([^"]*)"[^>]+rel="canonical"/i);
  if (!canonical) fail(`${path} has no canonical link`);

  const ogImage = pick(
    html,
    /<meta[^>]+property="og:image"[^>]+content="([^"]*)"/i,
  ) ?? pick(html, /<meta[^>]+content="([^"]*)"[^>]+property="og:image"/i);
  if (!ogImage) {
    fail(`${path} has no og:image`);
  } else {
    const imageUrl = ogImage.startsWith("http") ? ogImage : `${BASE}${localPath(ogImage)}`;
    const local = new URL(imageUrl);
    const imageResponse = await get(`${BASE}${local.pathname}${local.search}`);
    const type = imageResponse.headers.get("content-type") ?? "";
    if (imageResponse.status !== 200 || !type.startsWith("image/png")) {
      fail(`${path} og:image ${ogImage} returned ${imageResponse.status} ${type || "(no type)"}`);
    }
  }

  // Internal links resolve.
  for (const link of internalLinks(html)) {
    const linkResponse = await statusOf(link, { follow: false });
    if (linkResponse.status >= 400 || linkResponse.status < 200) {
      fail(`${path} links to ${link} (${linkResponse.status})`);
    }
  }

  // JavaScript weight.
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });
    const bytes = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.endsWith(".js") || entry.initiatorType === "script")
        .reduce((sum, entry) => sum + (entry.transferSize || entry.encodedBodySize || 0), 0),
    );
    if (bytes > JS_LIMIT) {
      fail(`${path} ships ${Math.round(bytes / 1024)} KB of JavaScript (limit ${JS_LIMIT / 1024} KB)`);
    }
    console.log(
      `  ok   200   ${path}  (${Math.round(bytes / 1024)} KB JS${
        title ? `, "${title.slice(0, 48)}"` : ""
      })`,
    );
  } finally {
    await page.close();
  }
}

async function main() {
  console.log(`launch-check against ${BASE}\n`);

  const paths = await sitemapPaths();
  if (paths.length === 0) {
    fail("the sitemap listed no pages");
  } else {
    console.log(`sitemap: ${paths.length} pages\n`);
  }

  console.log("hidden routes (must 404):");
  await checkHidden();

  console.log("\nsitemap pages:");
  const browser = await chromium.launch();
  try {
    for (const path of paths) {
      await checkPage(path, browser);
    }
  } finally {
    await browser.close();
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`launch-check failed (${failures.length}):`);
    for (const message of failures) console.error(`  x ${message}`);
    process.exit(1);
  }
  console.log("launch-check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
