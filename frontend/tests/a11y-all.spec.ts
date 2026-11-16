import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TEXT_SPACING,
  findClippedText,
  findOverlappingText,
  measureOverflow,
  settle,
} from "./reflowChecks";

// On demand only: set A11Y_ALL=1. Every URL from a launch-crawl JSON gets
// - an axe pass (WCAG 2.0/2.1/2.2 A and AA rules, every impact) at 1280 px in
//   light and in dark, and one at 320 px;
// - a 320 px reflow pass with the WCAG 1.4.12 text-spacing overrides: no
//   page-level horizontal scroll, no clipped text, no overlapping text.
// Production URLs map to their paths on the server under test. A11Y_ALL_CRAWL
// points at the crawl JSON; the default is the planning copy the CSP sweep
// also reads. A URL that redirects elsewhere on the local build (an event
// whose date has passed in the local bundle) is skipped: its target is in the
// crawl too.
//
//   A11Y_ALL=1 A11Y_ALL_CRAWL=crawl.json npx playwright test tests/a11y-all.spec.ts
const ENABLED = process.env.A11Y_ALL === "1";
const CRAWL =
  process.env.A11Y_ALL_CRAWL ??
  resolve(process.cwd(), "../../_plan/kp-2026-11/reports/launch-crawl.json");
const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
];

function crawlRoutes(): string[] {
  if (!ENABLED || !existsSync(CRAWL)) return [];
  const crawl = JSON.parse(readFileSync(CRAWL, "utf8")) as {
    pages_data: Array<{ url: string; content_type?: string }>;
  };
  const routes = crawl.pages_data
    .filter((page) => (page.content_type ?? "text/html").includes("html"))
    .map((page) => new URL(page.url).pathname);
  return [...new Set(routes)];
}

const ROUTES = crawlRoutes();

async function seedTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    localStorage.setItem("strikehike-theme", value);
  }, theme);
  await page.emulateMedia({ colorScheme: theme });
}

// Every WCAG A/AA violation, whatever its impact, as one line per rule.
async function axeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  // A run that checked nothing would pass silently.
  expect(results.passes.length, `${label}: axe ran no rules`).toBeGreaterThan(0);
  return results.violations.map(
    (violation) =>
      `${label} ${violation.id} (${violation.impact}) x${violation.nodes.length}: ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(" | ")}`,
  );
}

async function open(page: Page, route: string) {
  const response = await page.goto(route, { waitUntil: "load" });
  const landed = new URL(page.url()).pathname;
  const redirected = landed.replace(/\/$/, "") !== route.replace(/\/$/, "");
  if (redirected) {
    test.info().annotations.push({
      type: "redirect",
      description: `${route} -> ${landed}`,
    });
  }
  test.skip(redirected, `${route} redirects to ${landed} on this build`);
  expect(response?.status(), route).toBe(200);
  // Late data (the gauge, the atlas) should be on the page before axe runs;
  // pages that keep a connection open get 3 s at most.
  await page
    .waitForLoadState("networkidle", { timeout: 3_000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
}

test.describe("@a11y-all", () => {
  test.skip(!ENABLED, "set A11Y_ALL=1 to sweep every crawl URL");
  // One retry, so a slow local page load shows up as "flaky" in the report
  // instead of failing a 40-minute sweep; a real violation fails twice.
  test.describe.configure({ retries: 1 });

  test("the crawl list is readable", () => {
    expect(existsSync(CRAWL), `crawl JSON at ${CRAWL}`).toBe(true);
    expect(ROUTES.length, CRAWL).toBeGreaterThan(0);
  });

  for (const route of ROUTES) {
    test(`axe WCAG A/AA, light and dark: ${route}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1280, height: 800 });
      const found: string[] = [];
      for (const theme of ["light", "dark"] as const) {
        await seedTheme(page, theme);
        await open(page, route);
        found.push(...(await axeViolations(page, theme)));
      }
      expect(found, `${route} axe`).toEqual([]);
    });

    test(`axe at 320, reflow with text spacing: ${route}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 320, height: 800 });
      await open(page, route);
      // The phone layout gets its own axe pass before the overrides go in.
      expect(await axeViolations(page, "320"), `${route} axe at 320`).toEqual(
        [],
      );

      await page.addStyleTag({ content: TEXT_SPACING });
      await settle(page);
      const overflow = await measureOverflow(page);
      expect(
        overflow.root,
        `${route} root ${overflow.root} > viewport ${overflow.viewport}`,
      ).toBeLessThanOrEqual(overflow.viewport + 1);
      expect(
        overflow.body,
        `${route} body ${overflow.body} > viewport ${overflow.viewport}`,
      ).toBeLessThanOrEqual(overflow.viewport + 1);
      expect(await findClippedText(page), `${route} clipped text`).toEqual([]);
      expect(
        await findOverlappingText(page),
        `${route} overlapping text`,
      ).toEqual([]);
    });
  }
});
