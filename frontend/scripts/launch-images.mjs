#!/usr/bin/env node
// Builds the launch kit's images from the site's own prebuilt data, so every
// number in them is the same number the /tested pages show:
//
//   docs/launch/img/oc-chart.png         1600 x 1000  (r/dataisbeautiful [OC])
//   docs/launch/img/x-1200x675.png       1200 x  675  (X / Twitter card)
//   docs/launch/img/linkedin-1200x1500.png 1200 x 1500 (LinkedIn card)
//
// With DEMO_BASE set, it also records the home orrery to
// docs/launch/img/demo.webm (Playwright video) and captures demo-poster.png:
//
//   DEMO_BASE=http://127.0.0.1:3000 node scripts/launch-images.mjs
//
// DEMO_BASE must be a production server (next start, or https://strikehike.com),
// never next dev: the recording includes the page exactly as visitors see it.
//
// Run from frontend/. Uses the Playwright Chromium already installed for the
// smoke suite; no new dependency and no server needed for the three cards.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, "..");
const ROOT = path.resolve(FRONTEND, "..");
const OUT = path.join(ROOT, "docs", "launch", "img");
const TESTED = path.join(FRONTEND, "content", "tested");
const OG = path.join(FRONTEND, "src", "app", "_og");

const CLAIMS = [
  { id: "mercury-retrograde", short: "Mercury retrograde" },
  { id: "full-moon", short: "Full moon" },
  { id: "eclipses", short: "Eclipses" },
];

const INK = "#f2ede4";
const CORAL = "#ff8b77";
const MUTED = "rgba(242,237,228,0.62)";
const FAINT = "rgba(242,237,228,0.16)";

async function loadClaims() {
  const claims = [];
  for (const { id, short } of CLAIMS) {
    const raw = await readFile(path.join(TESTED, `${id}.json`), "utf8");
    claims.push({ ...JSON.parse(raw), short });
  }
  return claims;
}

const pct2 = (value) => `${(value * 100).toFixed(2)}%`;
const p3 = (value) => value.toFixed(3);

// The mean return per window each year, drawn as the site's own ClaimChart does.
function sparkline(points, width, height) {
  const pad = 10;
  const span = Math.max(1, ...points.map((point) => Math.abs(point.value)));
  const x = (index) => pad + (index / (points.length - 1)) * (width - pad * 2);
  const y = (value) =>
    height / 2 - (Math.max(-span, Math.min(span, value)) / span) * (height / 2 - pad);
  const d = points
    .map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`)
    .join(" ");
  const zero = height / 2;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none">
    <line x1="${pad}" x2="${width - pad}" y1="${zero}" y2="${zero}" stroke="${FAINT}" stroke-width="1"/>
    <path d="${d}" fill="none" stroke="${CORAL}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

async function fontFaces() {
  const light = await readFile(path.join(OG, "Onest-Light.ttf"));
  const medium = await readFile(path.join(OG, "Onest-Medium.ttf"));
  return `
    @font-face { font-family: Onest; font-weight: 300; src: url(data:font/ttf;base64,${light.toString("base64")}); }
    @font-face { font-family: Onest; font-weight: 500; src: url(data:font/ttf;base64,${medium.toString("base64")}); }
  `;
}

function shell(body, { width, height }, fonts) {
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    ${fonts}
    * { box-sizing: border-box; margin: 0; }
    html, body { width: ${width}px; height: ${height}px; }
    body {
      font-family: Onest, system-ui, sans-serif; color: ${INK};
      background-color: #090910;
      background-image: radial-gradient(ellipse at 50% 22%, #232330 0%, #141420 32%, #090910 64%, #020204 100%);
    }
    .eyebrow { font-size: 20px; font-weight: 500; letter-spacing: 5px; text-transform: uppercase; color: ${CORAL}; }
    .muted { color: ${MUTED}; }
    .num { font-variant-numeric: tabular-nums; }
  </style></head><body>${body}</body></html>`;
}

function ocChart(claims, fonts) {
  const W = 1600;
  const H = 1000;
  const header = `
    <div style="padding: 56px 72px 0;">
      <div class="eyebrow">StrikeHike · Tested</div>
      <div style="margin-top: 14px; font-size: 46px; font-weight: 300; letter-spacing: -1.4px; line-height: 1.05;">
        Do the Moon and Mercury move the S&amp;P&nbsp;500?
      </div>
      <div class="muted" style="margin-top: 12px; font-size: 24px; font-weight: 300;">
        Three claims, the same daily record, 1928&ndash;2026. Each line is the mean return per window each year (%). The middle line is zero.
      </div>
    </div>`;

  const cols = claims
    .map((claim) => {
      const cmp = claim.comparison;
      const span = `${claim.chart[0].year}&ndash;${claim.chart.at(-1).year}`;
      return `
      <div style="flex: 1 1 0; display: flex; flex-direction: column; gap: 16px;">
        <div style="font-size: 27px; font-weight: 500;">${claim.short}</div>
        <div style="height: 210px; border: 1px solid ${FAINT}; border-radius: 14px; padding: 8px 6px;">
          ${sparkline(claim.chart, 480, 192)}
        </div>
        <div class="muted" style="font-size: 18px;">mean return per window each year, ${span}</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; font-size: 22px;">
          <div class="muted">Windows</div><div class="num" style="text-align: right;">${cmp.in.n}</div>
          <div class="muted">Mean per window</div><div class="num" style="text-align: right;">${pct2(cmp.in.mean_return)}</div>
          <div class="muted">Matched windows</div><div class="num" style="text-align: right;">${pct2(cmp.out.mean_return)}</div>
          <div class="muted">p-value</div><div class="num" style="text-align: right;">${p3(cmp.p_value)}</div>
        </div>
        <div style="margin-top: 2px; display: inline-flex; align-items: center; gap: 10px; align-self: flex-start; padding: 8px 16px; border: 1px solid rgba(255,139,119,0.4); border-radius: 999px; color: ${CORAL}; font-size: 20px; font-weight: 500;">
          ${claim.result}
        </div>
      </div>`;
    })
    .join(`<div style="width: 1px; background: ${FAINT}; margin: 6px 34px;"></div>`);

  const footer = `
    <div style="padding: 0 72px; margin-top: 30px; display: flex; justify-content: space-between; align-items: baseline; border-top: 1px solid rgba(240,93,73,0.35); padding-top: 20px; font-size: 20px; font-weight: 300; color: ${MUTED};">
      <span>Source: StrikeHike /tested &middot; S&amp;P 500 / Cowles proxy, daily &middot; permutation tests, 2,000 draws</span>
      <span>strikehike.com/tested</span>
    </div>`;

  return shell(
    `<div style="display: flex; flex-direction: column; height: 100%;">${header}<div style="flex: 1; display: flex; align-items: center; padding: 18px 72px 0;">${cols}</div>${footer}</div>`,
    { width: W, height: H },
    fonts,
  );
}

function shareCard(claims, fonts, { height, body, width = 1200 }) {
  return shell(body(claims), { width, height }, fonts);
}

function xCard(claims, fonts) {
  const rows = claims
    .map(
      (claim) =>
        `<div style="flex: 1 1 0; display: flex; flex-direction: column; gap: 6px; padding: 18px 20px; border: 1px solid ${FAINT}; border-radius: 14px;">
          <div style="font-size: 22px; font-weight: 500;">${claim.short}</div>
          <div class="num muted" style="font-size: 20px;">p&nbsp;=&nbsp;${p3(claim.comparison.p_value)}</div>
          <div style="font-size: 17px; color: ${CORAL};">no meaningful difference</div>
        </div>`,
    )
    .join("");
  const body = () => `
    <div style="display: flex; flex-direction: column; height: 100%; padding: 54px 60px;">
      <div class="eyebrow">StrikeHike</div>
      <div style="margin-top: 18px; font-size: 50px; font-weight: 300; letter-spacing: -1.6px; line-height: 1.04;">
        We tested three market claims against 99 years of the S&amp;P&nbsp;500.
      </div>
      <div class="muted" style="margin-top: 14px; font-size: 24px; font-weight: 300;">
        Mercury retrograde, the full moon and eclipses. None showed a meaningful difference.
      </div>
      <div style="margin-top: auto; display: flex; gap: 16px;">${rows}</div>
      <div style="margin-top: 26px; display: flex; justify-content: space-between; font-size: 20px; color: ${MUTED}; border-top: 1px solid rgba(240,93,73,0.35); padding-top: 16px;">
        <span>Every number and method is on the page.</span><span>strikehike.com/tested</span>
      </div>
    </div>`;
  return shareCard(claims, fonts, { height: 675, body });
}

function linkedinCard(claims, fonts) {
  const head = `
        <div style="display: grid; grid-template-columns: 1.15fr 1.2fr 1.2fr 0.55fr; gap: 10px; padding: 18px 0 10px; border-top: 1px solid ${FAINT}; align-items: baseline;">
          <div class="muted" style="font-size: 17px;">Claim</div>
          <div class="muted" style="font-size: 17px; text-align: right;">Mean per window</div>
          <div class="muted" style="font-size: 17px; text-align: right;">Matched windows</div>
          <div class="muted" style="font-size: 17px; text-align: right;">p-value</div>
        </div>`;
  const rows = claims
    .map((claim) => {
      const c = claim.comparison;
      return `
        <div style="display: grid; grid-template-columns: 1.15fr 1.2fr 1.2fr 0.55fr; gap: 10px; padding: 20px 0; border-top: 1px solid ${FAINT}; align-items: baseline;">
          <div style="font-size: 26px; font-weight: 500;">${claim.short}</div>
          <div class="num" style="font-size: 24px; text-align: right;">${pct2(c.in.mean_return)}</div>
          <div class="num" style="font-size: 24px; text-align: right;">${pct2(c.out.mean_return)}</div>
          <div class="num" style="font-size: 24px; text-align: right;">p&nbsp;${p3(c.p_value)}</div>
        </div>`;
    })
    .join("");
  const body = () => `
    <div style="display: flex; flex-direction: column; height: 100%; padding: 66px 64px;">
      <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
        <div class="eyebrow">StrikeHike · Tested</div>
        <div style="margin-top: 22px; font-size: 56px; font-weight: 300; letter-spacing: -1.8px; line-height: 1.03;">
          Three claims, one 99-year record, no meaningful difference.
        </div>
        <div class="muted" style="margin-top: 18px; font-size: 26px; font-weight: 300; line-height: 1.35;">
          I put three market legends against the daily S&amp;P&nbsp;500 / Cowles record (1928&ndash;2026), using 2,000-draw permutation tests.
        </div>
        <div style="margin-top: 34px;">${head}${rows}
          <div style="border-top: 1px solid ${FAINT};"></div>
        </div>
        <div class="muted" style="margin-top: 14px; font-size: 20px; font-weight: 300; line-height: 1.4;">
          Mercury retrograde windows average about 22 days; full moon and eclipse windows are 7 days.
        </div>
        <div class="muted" style="margin-top: 20px; font-size: 21px; font-weight: 300; line-height: 1.4;">
          Mean per-window returns sit within noise of their matched windows for all three. Descriptive research, not investment advice; the site shows the method and every number.
        </div>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 22px; color: ${MUTED}; border-top: 1px solid rgba(240,93,73,0.35); padding-top: 18px;">
        <span>strikehike.com/tested</span><span>Source: StrikeHike, S&amp;P 500 / Cowles proxy</span>
      </div>
    </div>`;
  return shareCard(claims, fonts, { height: 1500, body });
}

async function shoot(browser, html, file, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, type: "png" });
  await page.close();
}

// Every card reports a return per window. A "/day" label would state a daily
// rate the tested JSON does not contain, so fail the build instead of shipping it.
function assertNoPerDayLabels(documents) {
  for (const [name, html] of Object.entries(documents)) {
    const match = html.match(/>[^<]*\/day[^<]*</i);
    if (match) {
      throw new Error(
        `${name}: label contains "/day" ("${match[0].slice(1, -1).trim()}"); returns are per window.`,
      );
    }
  }
}

async function recordDemo(base) {
  const dir = path.join(os.tmpdir(), "strikehike-launch-demo");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir, size: { width: 1440, height: 900 } },
    colorScheme: "dark",
  });
  // Dark theme and no first-visit hint. The theme is next-themes' class mode
  // (layout.tsx, storageKey "strikehike-theme"); the hint is hasSeenIntro.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("strikehike-theme", "dark");
      window.localStorage.setItem("hasSeenIntro", "1");
    } catch {
      // Storage can be unavailable; the recording still runs.
    }
  });
  const page = await context.newPage();
  // The probe flag is test-only and invisible: it gives the wrapper a
  // data-orrery-ready attribute once the camera intro has settled, so the
  // poster is never captured over an empty scene.
  const demoUrl = new URL(base);
  demoUrl.searchParams.set("orreryProbe", "1");
  await page.goto(demoUrl.toString(), { waitUntil: "load" });
  // Wait for the Sky activity reading and the settled orrery, then hold the
  // opening shot long enough that the corona is visible in poster and video.
  await page
    .waitForFunction(
      () => {
        const gauge = document.querySelector('[data-hud="gauge"] [role="img"]');
        const orrery = document.querySelector('[data-orrery-ready="true"]');
        return (
          Boolean(orrery) &&
          /Sky activity \d+ out of 100/.test(gauge?.getAttribute("aria-label") ?? "")
        );
      },
      { timeout: 20_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(1_000);
  const gaugeLabel = await page
    .locator('[data-hud="gauge"] [role="img"]')
    .first()
    .getAttribute("aria-label")
    .catch(() => null);
  const score = Number((gaugeLabel?.match(/Sky activity (\d+) out of 100/) ?? [])[1]);
  if (!Number.isFinite(score) || score < 85) {
    throw new Error(
      `demo needs the corona visible (Sky activity >= 85); got ${gaugeLabel ?? "no gauge"}`,
    );
  }
  const poster = path.join(OUT, "demo-poster.png");
  await page.screenshot({ path: poster, type: "png" });

  // A slow drag in the open sky so the orrery is visibly alive without opening
  // a body's detail popover.
  await page.mouse.move(1000, 420);
  await page.mouse.down();
  for (let step = 0; step < 18; step += 1) {
    await page.mouse.move(1000 - step * 8, 420 + (step % 2 ? 3 : -3));
    await page.waitForTimeout(90);
  }
  await page.mouse.up();
  await page.waitForTimeout(3_000);

  // One sound-panel open: pick the first soundscape, leave the panel visible,
  // then close it for the final beat. Open once, close once.
  const soundTrigger = page.locator('[data-shell="sound"] button').first();
  if (await soundTrigger.count().catch(() => 0)) {
    await soundTrigger.click().catch(() => {});
    await page.waitForTimeout(800);
    const firstScape = page.locator("[data-scape]").first();
    if (await firstScape.count().catch(() => 0)) {
      await firstScape.click().catch(() => {});
    }
    await page.waitForTimeout(3_000);
    await soundTrigger.click().catch(() => {});
  }
  await page.waitForTimeout(3_000);

  const video = page.video();
  await context.close();
  const source = await video.path();
  await browser.close();
  const target = path.join(OUT, "demo.webm");
  const bytes = await readFile(source);
  await writeFile(target, bytes);
  return { video: target, poster };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const claims = await loadClaims();
  const fonts = await fontFaces();
  const cards = [
    { file: "oc-chart.png", width: 1600, height: 1000, html: ocChart(claims, fonts) },
    { file: "x-1200x675.png", width: 1200, height: 675, html: xCard(claims, fonts) },
    {
      file: "linkedin-1200x1500.png",
      width: 1200,
      height: 1500,
      html: linkedinCard(claims, fonts),
    },
  ];
  assertNoPerDayLabels(
    Object.fromEntries(cards.map((card) => [card.file, card.html])),
  );
  const browser = await chromium.launch();
  try {
    for (const card of cards) {
      await shoot(
        browser,
        card.html,
        path.join(OUT, card.file),
        card.width,
        card.height,
      );
    }
  } finally {
    await browser.close();
  }
  console.log("wrote", cards.map((card) => card.file).join(", "), "to", OUT);

  const demoBase = process.env.DEMO_BASE;
  if (demoBase) {
    const { video, poster } = await recordDemo(demoBase);
    console.log("wrote", video, "and", poster);
  } else if (!existsSync(path.join(OUT, "demo.webm"))) {
    console.log("DEMO_BASE not set: skipped demo.webm (set DEMO_BASE=http://127.0.0.1:3000 to record it).");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
