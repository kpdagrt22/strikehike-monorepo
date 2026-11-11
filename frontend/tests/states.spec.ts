import { expect, test, type Page } from "@playwright/test";

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

const SIZES = [
  [1366, 768],
  [390, 844],
] as const;

test.describe("loading states", () => {
  for (const [width, height] of SIZES) {
    test(`Regime loading at ${width}`, { tag: width === 1366 ? "@deploy" : [] }, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height });
      await page.route("**/api/v1/regime/macro-history**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await route.continue();
      });
      await page.goto("/regime", { waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-regime-boot]")).toBeVisible();
      await expect(page.locator("[data-regime-boot]")).toContainText("Now");
      await page.screenshot({ path: `smoke-screens/regime-loading-${width}.png` });
      await expect(page.locator("[data-regime-readout]")).toBeVisible({
        timeout: 20_000,
      });
      expect(errors).toEqual([]);
    });
  }

  test("an Upcoming theme shows its skeleton on a client navigation", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/upcoming", { waitUntil: "networkidle" });
    await page.route("**/upcoming/finance**", async (route) => {
      if (route.request().headers().rsc) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      await route.continue();
    });
    await page.getByRole("link", { name: /^Finance/ }).first().click();
    await expect(page.locator('[data-route-loading="list"]')).toBeVisible();
    await page.screenshot({
      path: "smoke-screens/upcoming-loading-1366.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "smoke-screens/upcoming-loading-390.png",
    });
    await expect(page.getByRole("heading", { name: "Finance dates" })).toBeVisible({
      timeout: 15_000,
    });
    expect(errors).toEqual([]);
  });
});

test.describe("error states", () => {
  for (const [width, height] of SIZES) {
    test(`Regime error and Retry at ${width}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height });
      let fail = true;
      await page.route("**/api/v1/regime/macro-history**", async (route) => {
        if (fail) {
          fail = false;
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ detail: "upstream failed" }),
          });
          return;
        }
        await route.continue();
      });
      await page.goto("/regime", { waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-regime-error]")).toBeVisible();
      await expect(page.locator("[data-regime-error]")).toContainText(
        "The macro archive is not responding.",
      );
      await page.screenshot({ path: `smoke-screens/regime-error-${width}.png` });
      await page.locator("[data-regime-error] [data-retry]").click();
      await expect(page.locator("[data-regime-readout]")).toBeVisible({
        timeout: 20_000,
      });
      expect(errors.filter((error) => !error.includes("500"))).toEqual([]);
    });
  }
});

test.describe("404 and no WebGL", () => {
  for (const [width, height] of SIZES) {
    test(`404 at ${width}`, { tag: width === 1366 ? "@deploy" : [] }, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height });
      const response = await page.goto("/not-a-page", {
        waitUntil: "networkidle",
      });
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "Off the timeline." })).toBeVisible();
      for (const name of ["Orrery", "Regime", "Upcoming dates"]) {
        await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
      }
      await page.screenshot({ path: `smoke-screens/404-${width}.png` });
      expect(errors.filter((error) => !error.includes("404"))).toEqual([]);
    });

    test(`no WebGL at ${width}`, { tag: width === 1366 ? "@deploy" : [] }, async ({ page }) => {
      const errors = watchErrors(page);
      await page.addInitScript(() => {
        const proto = HTMLCanvasElement.prototype as unknown as {
          getContext: (type: string, ...args: unknown[]) => unknown;
        };
        const original = proto.getContext;
        proto.getContext = function (type: string, ...args: unknown[]) {
          if (type.startsWith("webgl")) return null;
          return original.call(this, type, ...args);
        };
      });
      await page.setViewportSize({ width, height });
      await page.goto("/", { waitUntil: "networkidle" });
      await expect(page.locator("[data-orrery-fallback]")).toBeVisible();
      await expect(page.locator("[data-orrery-fallback]")).toContainText(
        "3D view isn't available in this browser.",
      );
      await expect(page.locator('[data-hud="gauge"]')).toBeVisible();
      await page.screenshot({ path: `smoke-screens/no-webgl-${width}.png` });
      expect(errors).toEqual([]);
    });
  }
});
