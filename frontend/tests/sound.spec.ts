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
  test("sound is on by default; off stays off until turned back on", { tag: "@deploy" }, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto("/regime");

    // A first visit: the mode is on (Drift). Automated browsers never start
    // audio, so this checks the mode, not playback.
    const button = soundButton(page);
    await expect(button).toHaveAttribute("data-sound", "drift");
    await expect(button).toHaveAttribute("aria-label", /Sound on: Drift/);

    await button.click();
    const panel = page.locator("#site-sound-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("radio")).toHaveCount(3);
    await expect(panel.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    await panel.locator('[data-scape="orbit"]').click();
    await expect(button).toHaveAttribute("data-sound", "orbit");
    await expect(panel.locator('[data-scape="orbit"]')).toHaveAttribute("aria-checked", "true");

    // Off is remembered: across a reload and on another page.
    await panel.getByRole("switch").click();
    await expect(button).toHaveAttribute("data-sound", "off");
    expect(await page.evaluate(() => localStorage.getItem("sh.sound.v1"))).toContain('"off"');
    await page.reload();
    await expect(soundButton(page)).toHaveAttribute("data-sound", "off");
    await page.goto("/upcoming");
    await expect(soundButton(page)).toHaveAttribute("data-sound", "off");

    // Turning it back on resumes the last scape.
    await soundButton(page).click();
    await page.locator("#site-sound-panel").getByRole("switch").click();
    await expect(soundButton(page)).toHaveAttribute("data-sound", "orbit");

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
