import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const CLAIMS = [
  "mercury-retrograde",
  "full-moon",
  "eclipses",
  "new-moon",
  "solstices-equinoxes",
  "mars-retrograde",
  "mars-saturn-conjunction",
] as const;

async function seedTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    localStorage.setItem("strikehike-theme", value);
  }, theme);
  await page.emulateMedia({ colorScheme: theme });
}

test.describe("P17: more claim tests and culture dates", () => {
  test("the index lists seven claims and every page is axe clean", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/tested", { waitUntil: "networkidle" });
    await expect(page.locator("[data-claim-card]")).toHaveCount(7);
    for (const id of CLAIMS) {
      await expect(page.locator(`[data-claim-card="${id}"]`)).toBeVisible();
    }

    for (const theme of ["light", "dark"] as const) {
      for (const id of CLAIMS) {
        await seedTheme(page, theme);
        const response = await page.goto(`/tested/${id}`, {
          waitUntil: "domcontentloaded",
        });
        expect(response?.status(), `${id} ${theme}`).toBe(200);
        await expect(page.locator("h1")).toBeVisible();
        const results = await new AxeBuilder({ page }).analyze();
        expect(
          results.violations.filter((violation) =>
            ["serious", "critical"].includes(violation.impact ?? ""),
          ),
          `${id} ${theme}`,
        ).toEqual([]);
      }
    }
  });

  test(
    "Culture/Religion shows the new computed and curated dates",
    { tag: "@deploy" },
    async ({ page }) => {
      const response = await page.goto("/upcoming/culture-religion", {
        waitUntil: "networkidle",
      });
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toContainText("Culture and religion");
      expect(await page.locator("[data-upcoming-row]").count()).toBeGreaterThan(0);
      await expect(page.locator("body")).toContainText("Christmas 2026");
      await expect(page.locator("body")).toContainText("Chinese New Year 2027");
      await expect(page.locator("body")).toContainText("Holi 2027");
    },
  );
});
