#!/usr/bin/env node
// LAUNCH-crawl: read-only production crawl at no more than 2 requests/second.
//
//   node scripts/launch-crawl.mjs --base-url=https://strikehike.com \
//     --out=reports/launch-crawl.json --markdown=reports/launch-crawl.md
//
// Seeds from sitemap.xml, then follows same-host internal links. Checks status,
// one-hop redirects, canonical, title/description presence and uniqueness, OG
// image, JSON-LD, mixed content, internal 404s, security headers and
// Cache-Control.

import { writeFileSync } from "node:fs";

const UA = "StrikeHike-launch-crawl/1.0 (+https://strikehike.com/about)";
const RATE_MS = Math.max(200, Number(arg("rate-ms", "500")) || 500);

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const baseUrl = arg("base-url", "https://strikehike.com").replace(/\/+$/, "");
const outPath = arg("out", "reports/launch-crawl.json");
const markdownPath = arg("markdown", "reports/launch-crawl.md");
const host = new URL(baseUrl).host;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequest = 0;

async function request(url, options = {}) {
  const wait = RATE_MS - (Date.now() - lastRequest);
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  return fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": UA, Accept: "*/*" },
    signal: AbortSignal.timeout(30_000),
    ...options,
  });
}

async function fetchPage(url) {
  const chain = [];
  let current = url;
  for (let hop = 0; hop <= 1; hop += 1) {
    const response = await request(current);
    chain.push({ url: current, status: response.status, location: response.headers.get("location") });
    if (response.status >= 300 && response.status < 400 && hop === 0) {
      const location = response.headers.get("location");
      if (!location) break;
      current = new URL(location, current).href;
      continue;
    }
    const text = await response.text();
    return { response, finalUrl: current, chain, text };
  }
  return { response: null, finalUrl: current, chain, text: "" };
}

function meta(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1].trim() : "";
}

function decode(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function socialImage(html, pageUrl) {
  const value = meta(
    html,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  ) || meta(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!value) return "";
  try {
    return new URL(decode(value), pageUrl).href;
  } catch {
    return "";
  }
}

function imageSize(buffer, type) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (type.includes("png") && buffer.length > 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type.includes("jpeg") || type.includes("jpg")) {
    let index = 2;
    while (index + 9 < buffer.length) {
      if (buffer[index] !== 0xff) { index += 1; continue; }
      const marker = buffer[index + 1];
      const length = view.getUint16(index + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: view.getUint16(index + 5), width: view.getUint16(index + 7) };
      }
      index += 2 + length;
    }
  }
  if (type.includes("webp") && buffer.length > 30) {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
      return {
        width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
        height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
      };
    }
  }
  return null;
}

function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) blocks.push(match[1]);
  return blocks;
}

function internalLinks(html, pageUrl) {
  const links = new Set();
  const pattern = /<a[^>]+href=["']([^"'#]+)["']/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try {
      const url = new URL(decode(match[1]), pageUrl);
      if (url.host !== host) continue;
      if (url.pathname.startsWith("/api/")) continue;
      if (/\.(png|jpg|jpeg|webp|svg|ico|xml|json|txt|pdf|ics|zip|css|js)$/i.test(url.pathname)) continue;
      links.add(`${url.origin}${url.pathname}${url.search}`);
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return [...links];
}

function mixedContent(html) {
  const hits = new Set();
  const pattern = /<(?:img|script|iframe|link|source)[^>]+(?:src|href)=["'](http:\/\/[^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html))) hits.add(match[1]);
  return [...hits];
}

function normalize(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return url;
  }
}

async function ogImage(url) {
  if (!url) return { url: "", status: 0, bytes: 0, type: "", width: null, height: null };
  const response = await request(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") ?? "";
  return {
    url,
    status: response.status,
    bytes: buffer.length,
    type,
    ...(imageSize(buffer, type) ?? { width: null, height: null }),
  };
}

const sitemapUrl = `${baseUrl}/sitemap.xml`;
const sitemapResponse = await request(sitemapUrl);
const sitemapText = await sitemapResponse.text();
const sitemapStatus = sitemapResponse.status;
const seed = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decode(match[1]));
const thisWeekLastmod = sitemapText.match(
  /<loc>https:\/\/strikehike\.com\/this-week<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/,
)?.[1] ?? "";

const queue = [...new Set(seed)];
const seen = new Set();
const pages = [];

while (queue.length > 0) {
  const url = queue.shift();
  const key = normalize(url);
  if (seen.has(key)) continue;
  seen.add(key);
  process.stderr.write(`[${seen.size}/${seen.size + queue.length}] ${url}\n`);

  let result;
  try {
    result = await fetchPage(url);
  } catch (error) {
    pages.push({ url, error: String(error) });
    continue;
  }
  const { response, finalUrl, chain, text } = result;
  if (!response) {
    pages.push({ url, error: "no response after one redirect" });
    continue;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isHtml = contentType.includes("text/html");
  const title = isHtml ? decode(meta(text, /<title[^>]*>([\s\S]*?)<\/title>/i)) : "";
  const description = isHtml
    ? decode(meta(text, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i))
    : "";
  const canonical = isHtml
    ? decode(meta(text, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i))
    : "";
  const blocks = isHtml ? jsonLdBlocks(text) : [];
  let jsonLdOk = 0;
  for (const block of blocks) {
    try {
      JSON.parse(block);
      jsonLdOk += 1;
    } catch {
      // Counted as invalid.
    }
  }
  const links = isHtml ? internalLinks(text, finalUrl) : [];
  for (const link of links) {
    if (!seen.has(normalize(link))) queue.push(link);
  }

  pages.push({
    url,
    status: response.status,
    final_url: finalUrl,
    redirect_hops: Math.max(0, chain.length - 1),
    redirect_chain: chain,
    content_type: contentType,
    title,
    description,
    canonical,
    canonical_ok: canonical ? normalize(canonical) === normalize(finalUrl) : false,
    og_image: isHtml ? await ogImage(socialImage(text, finalUrl)) : null,
    jsonld_blocks: blocks.length,
    jsonld_ok: jsonLdOk,
    internal_links: links,
    mixed_content: isHtml ? mixedContent(text) : [],
    headers: {
      hsts: response.headers.get("strict-transport-security") ?? "",
      nosniff: response.headers.get("x-content-type-options") ?? "",
      referrer: response.headers.get("referrer-policy") ?? "",
      csp_report_only: response.headers.get("content-security-policy-report-only") ?? "",
      cache_control: response.headers.get("cache-control") ?? "",
    },
  });
}

// Internal 404s: a page's final URL 404s, or an internal link's normalized
// page was crawled and 404s.
const statusByKey = new Map(pages.filter((page) => page.final_url).map((page) => [normalize(page.final_url), page.status]));
for (const page of pages) {
  if (page.status === undefined || page.status >= 400) continue;
  page.internal_404s = [];
  for (const link of page.internal_links ?? []) {
    const status = statusByKey.get(normalize(link));
    if (status === 404) page.internal_404s.push(link);
  }
}

const htmlPages = pages.filter((page) => page.content_type?.includes("text/html"));
const titles = new Map();
const descriptions = new Map();
for (const page of htmlPages) {
  if (page.title) titles.set(page.title, (titles.get(page.title) ?? 0) + 1);
  if (page.description) descriptions.set(page.description, (descriptions.get(page.description) ?? 0) + 1);
}
for (const page of htmlPages) {
  page.title_unique = page.title ? titles.get(page.title) === 1 : false;
  page.description_unique = page.description ? descriptions.get(page.description) === 1 : false;
}

const summary = {
  base_url: baseUrl,
  crawled_at: new Date().toISOString(),
  sitemap_status: sitemapStatus,
  this_week_lastmod: thisWeekLastmod,
  pages: pages.length,
  html_pages: htmlPages.length,
  status_counts: pages.reduce((accumulator, page) => {
    const key = String(page.status ?? page.error ?? "error");
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {}),
  pages_data: pages,
  issues: {
    non_200: pages.filter((page) => page.status !== 200).map((page) => ({ url: page.url, status: page.status, error: page.error })),
    redirect_over_one: pages.filter((page) => (page.redirect_hops ?? 0) > 1),
    canonical_mismatch: htmlPages.filter((page) => !page.canonical_ok),
    missing_title: htmlPages.filter((page) => !page.title),
    duplicate_titles: [...titles.entries()].filter(([, count]) => count > 1),
    missing_description: htmlPages.filter((page) => !page.description),
    duplicate_descriptions: [...descriptions.entries()].filter(([, count]) => count > 1),
    og_image_bad: htmlPages.filter((page) => !page.og_image?.url || page.og_image.status !== 200),
    jsonld_invalid: htmlPages.filter((page) => page.jsonld_blocks !== page.jsonld_ok),
    mixed_content: htmlPages.filter((page) => page.mixed_content.length > 0),
    internal_404: htmlPages.filter((page) => (page.internal_404s ?? []).length > 0),
    missing_hsts: htmlPages.filter((page) => !page.headers?.hsts),
    missing_nosniff: htmlPages.filter((page) => page.headers?.nosniff !== "nosniff"),
    missing_referrer: htmlPages.filter((page) => !page.headers?.referrer),
    missing_csp: htmlPages.filter((page) => !page.headers?.csp_report_only),
    missing_cache_control: htmlPages.filter((page) => !page.headers?.cache_control),
  },
};

const markdown = [
  `## LAUNCH-crawl · ${baseUrl} · ${summary.crawled_at}`,
  "",
  `Sitemap ${summary.sitemap_status}; ${summary.pages} URLs crawled (${summary.html_pages} HTML); seeded from sitemap and internal links at 2 req/s.`,
  "",
  "| Check | Count |",
  "|---|---:|",
  ...Object.entries(summary.issues).map(([name, value]) => `| ${name} | ${value.length} |`),
  "",
  `JSON: \`${outPath}\``,
].join("\n");

writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, `${markdown}\n`, "utf8");
console.log(markdown);
if (
  summary.issues.non_200.length ||
  summary.issues.canonical_mismatch.length ||
  summary.issues.missing_title.length ||
  summary.issues.missing_description.length ||
  summary.issues.og_image_bad.length ||
  summary.issues.internal_404.length ||
  // Kept from the B4 crawl's exit rule: invalid JSON-LD, mixed content and
  // missing security headers stay failures (all zero on 15 Nov).
  summary.issues.jsonld_invalid.length ||
  summary.issues.mixed_content.length ||
  summary.issues.missing_hsts.length ||
  summary.issues.missing_nosniff.length ||
  summary.issues.missing_referrer.length
) {
  process.exitCode = 1;
}
