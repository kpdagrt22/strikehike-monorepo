import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/** Names of the curated Culture/Religion festivals dated from today through
 *  the next 365 days (the /upcoming horizon). */
function curatedCultureDates(today: string): string[] {
  const toml = readFileSync(
    join(process.cwd(), "..", "backend", "data", "events", "curated", "culture_religion.toml"),
    "utf8",
  );
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 365 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const names: string[] = [];
  for (const block of toml.split(/^\[\[events\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const date = /^date\s*=\s*"(\d{4}-\d{2}-\d{2})"/m.exec(block)?.[1];
    if (name && date && date >= today && date <= horizon) names.push(name);
  }
  return names;
}

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

  test("every claim page is axe clean at 390 px", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ["light", "dark"] as const) {
      for (const id of CLAIMS) {
        await seedTheme(page, theme);
        const response = await page.goto(`/tested/${id}`, {
          waitUntil: "domcontentloaded",
        });
        expect(response?.status(), `${id} ${theme}`).toBe(200);
        const results = await new AxeBuilder({ page }).analyze();
        expect(
          results.violations.filter((violation) =>
            ["serious", "critical"].includes(violation.impact ?? ""),
          ),
          `${id} ${theme} 390`,
        ).toEqual([]);
      }
    }
  });

  test(
    "Culture/Religion shows the new computed and curated dates",
    { tag: "@deploy" },
    async ({ page }) => {
      // The served bundle is built for today, in CI and on a local stack alike
      // (backend/scripts/smoke_events_bundle.py), so the expected names follow
      // today's date rather than fixed years: "Christmas 2026" leaves the
      // 12-month window on 26 Dec 2026 and "Holi 2027" on 24 Mar 2027. The
      // check is as strict as before: the next Christmas and the next Chinese
      // New Year (computed), and every curated festival dated in the next 12
      // months (Holi 2027 among them until 23 Mar 2027).
      const response = await page.goto("/upcoming/culture-religion", {
        waitUntil: "networkidle",
      });
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toContainText("Culture and religion");
      expect(await page.locator("[data-upcoming-row]").count()).toBeGreaterThan(0);

      const today = new Date().toISOString().slice(0, 10);
      const year = Number(today.slice(0, 4));
      const body = page.locator("body");
      await expect(body).toContainText(
        `Christmas ${today <= `${year}-12-25` ? year : year + 1}`,
      );
      // Chinese New Year falls between 21 Jan and 20 Feb.
      const newYears =
        today < `${year}-01-21`
          ? [year]
          : today > `${year}-02-20`
            ? [year + 1]
            : [year, year + 1];
      await expect(body).toContainText(
        new RegExp(`Chinese New Year (${newYears.join("|")})`),
      );
      const curated = curatedCultureDates(today);
      expect(
        curated.length,
        "verified Culture/Religion dates in the next 12 months (backend/data/events/curated/culture_religion.toml)",
      ).toBeGreaterThan(0);
      for (const name of curated) await expect(body).toContainText(name);
    },
  );
});
