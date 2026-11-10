import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Part B: the Regime page says each thing once, leads with the reading, and
// keeps the chart's top inside the first 600 px on a phone.

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function latestScore(request: APIRequestContext) {
  const response = await request.get(
    "/api/v1/regime/macro-history?resolution=weekly&view=atlas",
  );
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  const value = payload?.meta?.latest_core_index?.score;
  expect(typeof value).toBe("number");
  return `${value >= 0 ? "+" : ""}${Number(value).toFixed(1)}`;
}

async function openRegime(page: Page) {
  await page.goto("/regime", { waitUntil: "networkidle" });
  await page.waitForFunction(
    () =>
      /[+-]\d+\.\d/.test(
        document.querySelector("[data-regime-readout]")?.textContent ?? "",
      ),
    { timeout: 25_000 },
  );
  await page.waitForTimeout(700);
}

test.describe("regime revamp", () => {
  test("the latest score appears once above the chart, with one hint", { tag: "@deploy" }, async ({
    page,
    request,
  }) => {
    const errors = watchErrors(page);
    const score = await latestScore(request);
    await page.setViewportSize({ width: 1366, height: 768 });
    await openRegime(page);

    const chart = await page
      .locator('[data-testid="regime-terminal-chart"]')
      .boundingBox();
    expect(chart).not.toBeNull();

    const hits = await page.evaluate(
      ({ expected, top }) => {
        const nodes: string[] = [];
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement;
          if (!parent) continue;
          if (getComputedStyle(parent).visibility === "hidden") continue;
          if (getComputedStyle(parent).display === "none") continue;
          const text = (node.textContent ?? "").replace(/\u00a0/g, " ").trim();
          if (text !== expected) continue;
          if (parent.getBoundingClientRect().top >= top) continue;
          nodes.push(text);
        }
        return nodes;
      },
      { expected: score, top: chart!.y },
    );
    expect(hits, "the one lead reading").toEqual([score]);

    await expect(page.locator("[data-regime-hint]:visible")).toHaveCount(1);
    await expect(page.locator("[data-regime-card]")).toHaveCount(0);
    await expect(page.locator("[data-regime-axis-caption]")).toContainText(
      /recession windows/,
    );
    expect(
      await page.locator("[data-recession-window]").count(),
    ).toBeGreaterThan(0);

    // No snapshot-role element may cover the newest tenth of the series at rest.
    const lastTen = {
      x: chart!.x + chart!.width * 0.9,
      y: chart!.y,
      width: chart!.width * 0.1,
      height: chart!.height,
    };
    for (const card of await page.locator("[data-regime-card]").all()) {
      const box = await card.boundingBox();
      if (!box) continue;
      const intersects =
        box.x < lastTen.x + lastTen.width &&
        box.x + box.width > lastTen.x &&
        box.y < lastTen.y + lastTen.height &&
        box.y + box.height > lastTen.y;
      expect(intersects, "snapshot over the newest 10%").toBe(false);
    }

    expect(errors).toEqual([]);
  });

  test("the chart's top is inside 600 px on phones", { tag: "@deploy" }, async ({ page }) => {
    const errors = watchErrors(page);
    for (const [width, height] of [
      [390, 844],
      [360, 740],
    ] as const) {
      await page.setViewportSize({ width, height });
      await openRegime(page);
      const chart = await page
        .locator('[data-testid="regime-terminal-chart"]')
        .boundingBox();
      expect(chart, `${width}x${height}: chart`).not.toBeNull();
      expect(chart!.y, `${width}x${height}: chart top`).toBeLessThan(600);
    }
    expect(errors).toEqual([]);
  });

  test("readout, cycle and controls share one row at 1440 and 1920", async ({
    page,
  }) => {
    const errors = watchErrors(page);
    for (const [width, height] of [
      [1440, 900],
      [1920, 1080],
    ] as const) {
      await page.setViewportSize({ width, height });
      await openRegime(page);
      const [readout, cycle, controls, chart] = await Promise.all([
        page.locator("[data-regime-readout]").boundingBox(),
        page.locator("[data-regime-cycle]").boundingBox(),
        page.locator("[data-regime-controls]").boundingBox(),
        page.locator('[data-testid="regime-terminal-chart"]').boundingBox(),
      ]);
      expect(readout, `${width}: readout`).not.toBeNull();
      expect(cycle, `${width}: cycle`).not.toBeNull();
      expect(controls, `${width}: controls`).not.toBeNull();
      expect(chart, `${width}: chart`).not.toBeNull();

      const readoutBottom = readout!.y + readout!.height;
      const controlsBottom = controls!.y + controls!.height;
      expect(
        Math.abs(readoutBottom - controlsBottom),
        `${width}: aligned bottoms`,
      ).toBeLessThanOrEqual(24);
      expect(cycle!.x, `${width}: cycle beside the readout`).toBeGreaterThanOrEqual(
        readout!.x + readout!.width - 8,
      );
      const verticalOverlap =
        Math.min(readoutBottom, cycle!.y + cycle!.height) -
        Math.max(readout!.y, cycle!.y);
      expect(verticalOverlap, `${width}: cycle in the readout row`).toBeGreaterThan(0);
      expect(chart!.y, `${width}: chart top`).toBeLessThan(420);
    }
    expect(errors).toEqual([]);
  });

  test("a touch screen gets the press-and-hold hint", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    await openRegime(page);
    await expect(page.locator("[data-regime-hint]:visible")).toHaveText(
      "Press and hold to scrub · tap a band",
    );
    await context.close();
  });
});

test.describe("regime screenshots", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [390, 844],
      [360, 740],
    ] as const) {
      test(`${scheme} ${width}x${height}`, async ({ page }) => {
        const errors = watchErrors(page);
        await page.addInitScript((theme) => {
          localStorage.setItem("strikehike-theme", theme);
        }, scheme);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await openRegime(page);
        await page.screenshot({
          path: `smoke-screens/regime-${width}-${scheme}.png`,
        });
        expect(errors).toEqual([]);
      });
    }
  }
});
