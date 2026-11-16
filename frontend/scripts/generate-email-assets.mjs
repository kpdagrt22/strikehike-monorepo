// Generate the weekly email's hosted brand mark and icon set.
//
// A build-time tool, not a runtime dependency: Playwright (already a dev
// dependency) rasterises inline SVG in Chromium, so the PNGs are anti-aliased
// the same way the site's own SVG icons are. Run from `frontend/`:
//
//   node scripts/generate-email-assets.mjs            # write public/email/v3/
//   node scripts/generate-email-assets.mjs --sheet x  # also write a contact sheet PNG
//
// Email clients strip SVG, so every icon ships as a PNG at 2x (64 px for a
// 32 px tile). Each tile is the site's weekly chip in miniature: a round
// --sh-weekly-soft fill with a --sh-weekly-line ring, both semi-transparent, so
// the same file sits on the cream card, the night card and on a card a mail
// app has darkened by itself. The glyph is one bronze that keeps 3:1 against
// both composites (WCAG 1.4.11; the icons are decorative and carry alt="").
//
// The v2 files beside v3/ (logo-dark.png, icons/) are kept as they are: emails
// already delivered still point at them.
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "email", "v3");

// Site tokens (src/app/globals.css): --sh-weekly-soft rgb(216 180 122 / .16),
// --sh-weekly-line rgb(176 124 40 / .36). The glyph bronze sits between the
// light (#855404) and dark (#f0c674) weekly text steps.
const TILE_FILL = "rgba(216,180,122,0.18)";
const TILE_RING = "rgba(176,124,40,0.40)";
const GLYPH = "#a8741f";

// 24-unit glyphs, 1.75 stroke, round caps and joins: the site's icon grammar.
const S = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="currentColor" stroke="none"';
const CAL = `<rect x="3.5" y="5" width="17" height="15.5" rx="2.5" ${S}/><path d="M8 3v4M16 3v4M3.5 10h17" ${S}/>`;

export const GLYPHS = {
  "moon-new": `<circle cx="12" cy="12" r="7.5" ${S}/>`,
  "moon-first-quarter": `<circle cx="12" cy="12" r="7.5" ${S}/><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" ${F}/>`,
  "moon-full": `<circle cx="12" cy="12" r="7.5" ${S}/><circle cx="12" cy="12" r="7.5" ${F}/>`,
  "moon-last-quarter": `<circle cx="12" cy="12" r="7.5" ${S}/><path d="M12 4.5a7.5 7.5 0 0 0 0 15z" ${F}/>`,
  // A body crossing into a sign: the arrow through a threshold.
  ingress: `<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" ${S}/><path d="m9.5 16.5 4.5-4.5-4.5-4.5M14 12H3.5" ${S}/>`,
  // A planet that stands still and turns.
  station: `<circle cx="12" cy="12" r="2.75" ${S}/><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" ${S}/><path d="M19.8 3.8v3.6h-3.6" ${S}/>`,
  eclipse: `<circle cx="10" cy="12" r="6.5" ${S}/><circle cx="14.25" cy="12" r="6.5" ${F}/>`,
  season: `<circle cx="12" cy="12" r="3.75" ${S}/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" ${S}/>`,
  finance: `<path d="M4 4v14.5A1.5 1.5 0 0 0 5.5 20H20" ${S}/><path d="M8.5 16v-3M12.5 16V8M16.5 16v-5.5" ${S}/>`,
  culture: `<path d="M12 3.5c.6 3.9 2.1 5.4 6 6-3.9.6-5.4 2.1-6 6-.6-3.9-2.1-5.4-6-6 3.9-.6 5.4-2.1 6-6z" ${S}/><path d="M18.5 16v4M16.5 18h4" ${S}/>`,
  orbit: `<circle cx="12" cy="12" r="2.75" ${S}/><ellipse cx="12" cy="12" rx="9" ry="4.25" transform="rotate(-28 12 12)" ${S}/><circle cx="19.4" cy="8" r="1.6" ${F}/>`,
  regime: `<path d="M4.2 18.5a9 9 0 1 1 15.6 0" ${S}/><path d="m12 14 3.8-4.6" ${S}/><circle cx="12" cy="14" r="1.25" ${F}/>`,
  calendar: `${CAL}<path d="M8 14h.01M12 14h.01M16 14h.01M8 17.25h.01M12 17.25h.01" ${S}/>`,
  "calendar-plus": `${CAL}<path d="M12 12.5v5M9.5 15h5" ${S}/>`,
  "calendar-next": `${CAL}<path d="M8.5 15.25h7M13 12.75l2.5 2.5-2.5 2.5" ${S}/>`,
  ledger: `<path d="M9.5 16.5H8a4.5 4.5 0 0 1 0-9h1.5M14.5 7.5H16a4.5 4.5 0 0 1 0 9h-1.5M8.5 12h7" ${S}/>`,
  record: `<path d="M9 3.5h6M10 3.5v6L4.9 18.2A1.6 1.6 0 0 0 6.3 20.5h11.4a1.6 1.6 0 0 0 1.4-2.3L14 9.5v-6M7.3 14.5h9.4" ${S}/>`,
};

function tile(glyph) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="15.5" fill="${TILE_FILL}"/>
  <circle cx="16" cy="16" r="15.25" fill="none" stroke="${TILE_RING}" stroke-width="0.75"/>
  <g transform="translate(6.5 6.5) scale(0.7917)" color="${GLYPH}" style="color:${GLYPH}">${glyph}</g>
</svg>`;
}

async function shoot(page, html, width, height, path) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head><body>${html}</body></html>`,
  );
  await page.locator("body > *").first().screenshot({ path, omitBackground: true });
}

async function main() {
  const sheetIndex = process.argv.indexOf("--sheet");
  const sheet = sheetIndex > 0 ? resolve(process.argv[sheetIndex + 1]) : null;
  await mkdir(join(OUT, "icons"), { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    for (const [name, glyph] of Object.entries(GLYPHS)) {
      await shoot(page, tile(glyph), 32, 32, join(OUT, "icons", `${name}.png`));
    }
    // The brand mark: the site's own icon (public/icon.png), cropped round as
    // the header crops it, at 3x for a 32 px display.
    const icon = (await readFile(join(ROOT, "public", "icon.png"))).toString("base64");
    const mark = await browser.newContext({ deviceScaleFactor: 3 });
    const markPage = await mark.newPage();
    await shoot(
      markPage,
      `<img src="data:image/png;base64,${icon}" width="32" height="32" style="display:block;width:32px;height:32px;border-radius:50%">`,
      32,
      32,
      join(OUT, "mark.png"),
    );
    await mark.close();
    if (sheet) {
      const cells = Object.entries(GLYPHS)
        .map(
          ([name, glyph]) =>
            `<div style="display:inline-block;width:92px;text-align:center;margin:8px 0">${tile(glyph)}<div style="font:11px sans-serif;opacity:.7">${name}</div></div>`,
        )
        .join("");
      const panel = (bg, fg) =>
        `<div style="background:${bg};color:${fg};padding:16px;width:560px">${cells}</div>`;
      await page.setViewportSize({ width: 600, height: 800 });
      await page.setContent(
        `<!doctype html><body style="margin:0">${panel("#fcfaf7", "#2f2d33")}${panel("#0f0f16", "#e6e1d9")}${panel("#1e1e1e", "#e6e1d9")}</body>`,
      );
      await page.screenshot({ path: sheet, fullPage: true });
    }
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(`wrote ${OUT}`);
}

await main();
