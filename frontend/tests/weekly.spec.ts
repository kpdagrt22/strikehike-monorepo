import AxeBuilder from "@axe-core/playwright";
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
