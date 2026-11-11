import { expect, test, type Locator, type Page } from "@playwright/test";

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

async function visibleBox(locator: Locator) {
  if ((await locator.count()) === 0) return null;
  const first = locator.first();
  if (!(await first.isVisible())) return null;
  return first.boundingBox();
}

function soundButton(page: Page) {
  return page.locator('[data-shell="sound"] > button');
}

test.describe("ambient sound", () => {
  test("choose a soundscape, switch it off, and keep the choice", { tag: "@deploy" }, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/regime");

    const button = soundButton(page);
    await expect(button).toHaveAttribute("data-sound", "off");

    // Automated browsers never start sound on their own.
    await page.mouse.click(683, 600);
    await expect(button).toHaveAttribute("data-sound", "off");

    await button.click();
    const panel = page.locator("#site-sound-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("radio")).toHaveCount(3);

    await panel.locator('[data-scape="orbit"]').click();
    await expect(button).toHaveAttribute("data-sound", "orbit");
    await expect(panel.locator('[data-scape="orbit"]')).toHaveAttribute("aria-checked", "true");
    expect(await page.evaluate(() => localStorage.getItem("sh.sound.v1"))).toContain('"orbit"');

    await panel.getByRole("switch").click();
    await expect(button).toHaveAttribute("data-sound", "off");
    expect(await page.evaluate(() => localStorage.getItem("sh.sound.v1"))).toContain('"off"');

    // Turning it back on resumes the last scape, after a reload too.
    await panel.locator('[data-scape="wind"]').click();
    await page.reload();
    await soundButton(page).click();
    await page.locator("#site-sound-panel").getByRole("switch").click();
    await expect(soundButton(page)).toHaveAttribute("data-sound", "wind");

    await page.keyboard.press("Escape");
    await expect(page.locator("#site-sound-panel")).toBeHidden();
    expect(errors).toEqual([]);
  });

  for (const path of ["/", "/upcoming"]) {
    for (const [width, height] of [
      [390, 844],
      [768, 1024],
      [1024, 768],
      [1366, 768],
      [1920, 1080],
    ] as const) {
      test(`the sound button clears the header on ${path} at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto(path);
        const sound = await visibleBox(soundButton(page));
        expect(sound, "sound button is visible").not.toBeNull();

        const others = {
          brand: await visibleBox(page.locator('[data-shell="brand"]')),
          navPill: await visibleBox(page.locator('[data-shell="nav-pill"]')),
          navRow: await visibleBox(page.locator('[data-shell="nav-row"]')),
          menu: await visibleBox(page.getByRole("button", { name: "StrikeHike menu" })),
          info: await visibleBox(page.getByRole("button", { name: "About StrikeHike and contact" })),
        };
        for (const [name, box] of Object.entries(others)) {
          if (box) expect(overlaps(sound!, box), `sound overlaps ${name}`).toBe(false);
        }
        expect(sound!.x + sound!.width).toBeLessThanOrEqual(width);

        if (path === "/" && width === 390) {
          await page.screenshot({ path: "smoke-screens/sound-home-390.png" });
        }
        if (path === "/upcoming" && width === 1366) {
          await soundButton(page).click();
          await page.screenshot({ path: "smoke-screens/sound-panel-1366.png" });
        }
      });
    }
  }
});
