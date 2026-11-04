import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES = [
  { path: "/", texts: ["Sky ladder"] },
  { path: "/regime", texts: ["Macro atlas", "Method & record"] },
  { path: "/convergence", texts: ["Two events. One macro lens."] },
  { path: "/patterns", texts: ["The 120-year mirror."] },
  { path: "/disclaimer", texts: ["not registered with SEBI"] },
];

for (const route of ROUTES) {
  test(`${route.path} is healthy, readable and accessible`, async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    const response = await page.goto(route.path, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    for (const text of route.texts) {
      await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    }

    await page.waitForLoadState("networkidle");

    const accessibility = await new AxeBuilder({ page }).analyze();
    const serious = accessibility.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
