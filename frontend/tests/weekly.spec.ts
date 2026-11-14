import AxeBuilder from "@axe-core/playwright";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The weekly roundup is offered everywhere with one gold mark: the nav, the
// home intro, the footer of every scrolling page and its own pages.

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test.describe("weekly roundup spotlight", () => {
  test("the desktop nav carries This week and marks it current", async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/regime", { waitUntil: "networkidle" });
    const pill = page.locator('[data-shell="nav-pill"]');
    const weekly = pill.locator("[data-weekly-nav]");
    await expect(weekly).toBeVisible();
    await expect(weekly).toHaveText(/This week/);
    await weekly.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/this-week");
    await expect(pill.locator("[data-weekly-nav]")).toHaveAttribute("aria-current", "page");
    expect(errors).toEqual([]);
  });

  test("below lg the pill keeps five views and the menu offers This week", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/regime", { waitUntil: "networkidle" });
    await expect(page.locator('[data-shell="nav-pill"] [data-weekly-nav]')).toBeHidden();
    await page.getByRole("button", { name: "StrikeHike menu" }).click();
    await expect(page.locator("#site-nav-menu [data-weekly-nav]")).toBeVisible();
  });

  for (const path of ["/tested", "/about", "/recessions"]) {
    test(`${path} marks no view as current`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(
        page.locator('[data-shell="nav-pill"] [aria-current="page"]'),
      ).toHaveCount(0);
    });
  }

  test("the ledger and email pages belong to This week", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/ledger", { waitUntil: "networkidle" });
    await expect(
      page.locator('[data-shell="nav-pill"] [data-weekly-nav]'),
    ).toHaveAttribute("aria-current", "page");
  });

  test("home offers the roundup beside Upcoming dates", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });
    const link = page.locator("[data-home-weekly]");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/this-week");
    await expect(page.locator("[data-home-secondary]")).toBeVisible();
  });

  test("the footer promo shows on other pages, not on the roundup", async ({ page }) => {
    await page.goto("/about", { waitUntil: "networkidle" });
    const promo = page.locator("[data-weekly-promo]");
    await expect(promo).toBeVisible();
    await expect(promo.locator("[data-weekly-promo-link]")).toHaveAttribute("href", "/this-week");
    await page.goto("/this-week", { waitUntil: "networkidle" });
    await expect(page.locator("[data-weekly-promo]")).toHaveCount(0);
  });

  for (const [width, height, scheme] of [
    [1440, 900, "dark"],
    [1440, 900, "light"],
    [390, 844, "dark"],
    [390, 844, "light"],
  ] as const) {
    test(`/this-week at ${width} in ${scheme}: stat card, side column, axe clean`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: scheme,
      });
      const page = await context.newPage();
      const errors = watchErrors(page);
      await page.goto("/this-week", { waitUntil: "networkidle" });
      await expect(page.locator("[data-roundup-regime]")).toBeVisible();
      await expect(page.locator("[data-weekly-aside]")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
      const axe = await new AxeBuilder({ page }).analyze();
      const serious = axe.violations.filter(
        (violation) => violation.impact === "serious" || violation.impact === "critical",
      );
      expect(serious).toEqual([]);
      await page.screenshot({
        path: `smoke-screens/weekly-this-week-${width}-${scheme}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
      await context.close();
    });
  }
});

test.describe("v2 roundup rendering", () => {
  const fixturePath = join(process.cwd(), "content", "roundups", "2099-W01.json");

  test.beforeAll(async () => {
    const fixture = await readFile(
      join(process.cwd(), "tests", "fixtures", "roundup-v2.json"),
      "utf8",
    );
    await writeFile(fixturePath, fixture, "utf8");
  });

  test.afterAll(async () => {
    await unlink(fixturePath).catch(() => undefined);
  });

  test("W46 stays on the v1 one-line layout", async ({ page }) => {
    await page.goto("/this-week/2026-W46", { waitUntil: "networkidle" });
    await expect(page.locator("[data-roundup-schema='2']")).toHaveCount(0);
    await expect(page.locator("[data-roundup-sparkline]")).toHaveCount(0);
    await expect(page.locator("[data-roundup-quiet]")).toBeVisible();
  });

  for (const [width, height, scheme] of [
    [1440, 900, "dark"],
    [1440, 900, "light"],
    [390, 844, "dark"],
    [390, 844, "light"],
  ] as const) {
    test(`v2 fixture at ${width} in ${scheme}: every section, axe clean, no overflow`, async ({
      browser,
      request,
    }) => {
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: scheme,
      });
      const page = await context.newPage();
      const errors = watchErrors(page);
      await page.goto("/this-week/2099-W01", { waitUntil: "networkidle" });
      await expect(page.locator("[data-roundup-schema='2']")).toBeVisible();
      await expect(page.locator("[data-roundup-sparkline]")).toBeVisible();
      await expect(page.locator("[data-roundup-sky]")).toContainText("New moon");
      await expect(page.locator("[data-roundup-activity]")).toContainText(
        "Geometry match compares planet positions only",
      );
      await expect(page.locator("[data-roundup-next]")).toContainText(
        "Employment Situation",
      );
      await expect(page.locator("[data-roundup-record]")).toContainText(
        "The new moon and the market",
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
      const axe = await new AxeBuilder({ page }).analyze();
      expect(
        axe.violations.filter(
          (violation) =>
            violation.impact === "serious" || violation.impact === "critical",
        ),
      ).toEqual([]);
      const og = await page
        .locator('meta[property="og:image"]')
        .getAttribute("content");
      expect(og).toBeTruthy();
      const image = await request.get(new URL(og!).pathname);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toContain("image/png");
      await page.screenshot({
        path: `smoke-screens/weekly-v2-${width}-${scheme}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test("W47 shows the GDP release in the visitor's zone", async ({ browser }) => {
    const w47Path = join(
      process.cwd(),
      "content",
      "roundups",
      "2026-W47.json",
    );
    const original = await readFile(w47Path, "utf8");
    try {
      const draft = JSON.parse(original);
      draft.approved = true;
      await writeFile(w47Path, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
      const context = await browser.newContext({
        timezoneId: "Asia/Kolkata",
        viewport: { width: 1440, height: 900 },
        colorScheme: "light",
      });
      const page = await context.newPage();
      await page.goto("/this-week/2026-W47", { waitUntil: "networkidle" });
      const gdp = page
        .locator("[data-roundup-next] li")
        .filter({ hasText: "Gross Domestic Product" });
      await expect(gdp).toContainText("25 Nov");
      await expect(gdp).toContainText("19:00 IST");
      await expect(gdp).not.toContainText("08:30");
      await context.close();
    } finally {
      await writeFile(w47Path, original, "utf8");
    }
  });
});
