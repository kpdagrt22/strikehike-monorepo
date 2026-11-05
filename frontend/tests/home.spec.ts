import { expect, test, type Page } from "@playwright/test";

const H1 = "The market record beside the sky, tested in public.";
const PRIMARY = "See 170 years of markets beside the sky";
const VIEWS = [
  { label: "Orrery", href: "/" },
  { label: "Regime", href: "/regime" },
  { label: "Convergence", href: "/convergence" },
  { label: "Patterns", href: "/patterns" },
  { label: "Upcoming", href: "/upcoming" },
];

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function home(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("[data-home-intro]")).toBeVisible();
}

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

test.describe("home first paint", () => {
  test("the no-JavaScript HTML carries the promise and first action", async ({
    request,
  }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(H1);
    expect(html).toContain('href="/regime"');
    expect(html).not.toContain("October 28, 2026");
    expect(html).not.toContain("2026-10-28");
  });

  test("exactly one h1", async ({ page }) => {
    await home(page);
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("desktop headline and action are visible within 3 s", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      const started = Date.now();
      await page.goto("/", { waitUntil: "commit" });
      await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible(
        { timeout: 3_000 },
      );
      await expect(page.getByRole("link", { name: PRIMARY })).toBeVisible({
        timeout: Math.max(500, 3_000 - (Date.now() - started)),
      });
      expect(Date.now() - started).toBeLessThanOrEqual(3_000);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("phone headline and action are visible within 5 s at 4x CPU", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const started = Date.now();
      await page.goto("/", { waitUntil: "commit" });
      await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible(
        { timeout: 5_000 },
      );
      await expect(page.getByRole("link", { name: PRIMARY })).toBeVisible({
        timeout: Math.max(500, 5_000 - (Date.now() - started)),
      });
      expect(Date.now() - started).toBeLessThanOrEqual(5_000);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("home layout", () => {
  for (const [label, width, height] of [
    ["1440x900", 1440, 900],
    ["1280x720", 1280, 720],
    ["1024x768", 1024, 768],
    ["390x844", 390, 844],
  ] as const) {
    test(`headline clears the HUD at ${label}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height });
      await home(page);
      const intro = await page.locator("[data-home-intro]").boundingBox();
      expect(intro).not.toBeNull();
      console.log(`home intro ${label}`, intro);
      const targets = [
        page.locator('[data-hud="gauge"]'),
        page.locator("#chrono-alignment-sheet"),
        page.locator("#chrono-ladder-sheet"),
        page.locator('[data-hud="timeline"]'),
        page.locator('[data-hud="dock"]'),
      ];
      for (const target of targets) {
        if (!(await target.isVisible())) continue;
        const box = await target.boundingBox();
        if (!box) continue;
        expect(
          overlaps(intro!, box),
          `intro overlaps ${await target.evaluate((element) => element.id || element.getAttribute("data-hud"))}`,
        ).toBe(false);
      }
      expect(errors).toEqual([]);
    });
  }
});

test.describe("navigation is one action", () => {
  for (const [label, width, height] of [
    ["desktop", 1440, 900],
    ["phone", 390, 844],
  ] as const) {
    test(`every view on ${label}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height });
      for (const view of VIEWS) {
        await page.goto("/", { waitUntil: "networkidle" });
        const link = page.getByRole("link", {
          name: view.label,
          exact: true,
        }).first();
        await expect(link).toBeVisible();
        await link.click();
        await expect
          .poll(() => new URL(page.url()).pathname)
          .toBe(view.href);
        await expect(
          page.getByRole("link", { name: view.label, exact: true }).first(),
        ).toHaveAttribute("aria-current", "page");
      }
      expect(errors).toEqual([]);
    });
  }
});

test("the hint dismisses with Escape and stays dismissed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  const hint = page.locator("[data-home-hint]");
  await expect(hint).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(hint).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await expect(page.locator("[data-home-hint]")).toHaveCount(0);
});

test("Disclaimer is reachable from the menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  const menu = page.locator("#site-nav-menu");
  await page.getByRole("button", { name: "StrikeHike menu" }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "Disclaimer", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe("/disclaimer");
  await page.getByRole("button", { name: "StrikeHike menu" }).click();
  await expect(
    menu.getByRole("link", { name: "Disclaimer", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("Finance is fully visible in the home Upcoming chips", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  await page.locator("#chrono-dock-archive").click();
  await page.locator("#chrono-archive-to-ladder").click();
  await expect(page.locator("#upcoming-finance")).toBeVisible();
  const row = page.locator(
    '[role="group"][aria-label="Filter upcoming events by theme"]',
  );
  const chip = page.locator('button[data-theme="Finance"]');
  await chip.scrollIntoViewIfNeeded();
  const rowBox = await row.boundingBox();
  const chipBox = await chip.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(chipBox).not.toBeNull();
  expect(chipBox!.x).toBeGreaterThanOrEqual(rowBox!.x);
  expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(
    rowBox!.x + rowBox!.width,
  );
  expect(errors).toEqual([]);
});

test.describe("home review screenshots", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const [label, width, height] of [
      ["desktop", 1440, 900],
      ["phone", 390, 844],
    ] as const) {
      test(`first visit with hint, ${scheme} ${label}`, async ({ page }) => {
        await page.addInitScript((theme) => {
          localStorage.setItem("strikehike-theme", theme);
        }, scheme);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await home(page);
        await expect(page.locator("[data-home-hint]")).toBeVisible();
        await page.screenshot({
          path: `smoke-screens/home-first-${scheme}-${label}.png`,
        });
      });

      test(`returning visit without hint, ${scheme} ${label}`, async ({ page }) => {
        await page.addInitScript((theme) => {
          localStorage.setItem("strikehike-theme", theme);
          localStorage.setItem("hasSeenIntro", "1");
        }, scheme);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await home(page);
        await expect(page.locator("[data-home-hint]")).toHaveCount(0);
        await page.screenshot({
          path: `smoke-screens/home-return-${scheme}-${label}.png`,
        });
      });
    }
  }
});

test.describe("navigation review screenshots", () => {
  for (const scheme of ["dark", "light"] as const) {
    test(`header nav desktop, ${scheme}`, async ({ page }) => {
      await page.addInitScript((theme) => {
        localStorage.setItem("strikehike-theme", theme);
        localStorage.setItem("hasSeenIntro", "1");
      }, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1440, height: 900 });
      await home(page);
      await page.screenshot({
        path: `smoke-screens/header-nav-1440-${scheme}.png`,
        clip: { x: 0, y: 0, width: 1440, height: 90 },
      });
    });

    test(`header nav phone and scrolled row, ${scheme}`, async ({ page }) => {
      await page.addInitScript((theme) => {
        localStorage.setItem("strikehike-theme", theme);
        localStorage.setItem("hasSeenIntro", "1");
      }, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await home(page);
      await page.screenshot({
        path: `smoke-screens/header-nav-390-${scheme}.png`,
        clip: { x: 0, y: 0, width: 390, height: 124 },
      });
      await page.goto("/upcoming", { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `smoke-screens/header-nav-390-upcoming-${scheme}.png`,
        clip: { x: 0, y: 0, width: 390, height: 124 },
      });
    });

    test(`phone dock, ${scheme}`, async ({ page }) => {
      await page.addInitScript((theme) => {
        localStorage.setItem("strikehike-theme", theme);
        localStorage.setItem("hasSeenIntro", "1");
      }, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await home(page);
      await page.locator('[data-hud="dock"]').screenshot({
        path: `smoke-screens/dock-phone-${scheme}.png`,
      });
    });
  }
});
