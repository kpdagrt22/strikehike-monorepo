import { expect, test } from "@playwright/test";
import {
  TEXT_SPACING,
  findClippedText,
  findCoveredByLayer,
  findOverlappingText,
  measureOverflow,
  settle,
} from "./reflowChecks";

// WCAG 1.4.10 (reflow at 320 px) and 1.4.12 (text spacing). The route list is
// the main families; the on-demand @a11y-all sweep (a11y-all.spec.ts) runs
// the same checks on every crawl URL.
const ROUTES = [
  "/",
  "/disclaimer",
  "/about",
  "/regime",
  "/upcoming",
  "/convergence",
  "/tested/full-moon",
  "/this-week",
  "/events/finance~curated_upcoming~fomc-2026-12",
];

for (const route of ROUTES) {
  test(`reflow at 320 with text spacing: ${route}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(route, { waitUntil: "load" });
    await page.addStyleTag({ content: TEXT_SPACING });
    await settle(page);

    const overflow = await measureOverflow(page);
    expect(
      overflow.root,
      `${route} root ${overflow.root} > viewport ${overflow.viewport}`,
    ).toBeLessThanOrEqual(overflow.viewport + 1);
    expect(
      overflow.body,
      `${route} body ${overflow.body} > viewport ${overflow.viewport}`,
    ).toBeLessThanOrEqual(overflow.viewport + 1);

    expect(await findClippedText(page), `${route} clipped text`).toEqual([]);
    expect(
      await findOverlappingText(page),
      `${route} overlapping text`,
    ).toEqual([]);
  });
}

// The home page's first-visit hint floats over the page, so the overlap check
// above (which compares a fixed layer only with itself) cannot see it. On a
// short or narrow phone, and with text spacing, it must still cover no text and
// no control, and it must still close with its button or Esc.
for (const [width, height, spacing, closeWith] of [
  [320, 568, true, "button"],
  [320, 568, false, "Escape"],
  [320, 800, true, "Escape"],
  [360, 640, true, "button"],
  [390, 844, true, "Escape"],
] as const) {
  test(`first-visit hint covers nothing at ${width}x${height}${spacing ? " with text spacing" : ""}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await page.goto("/", { waitUntil: "load" });
    const hint = page.locator("[data-home-hint]");
    await expect(hint).toBeVisible();
    if (spacing) await page.addStyleTag({ content: TEXT_SPACING });
    await settle(page);

    expect(
      await findCoveredByLayer(page, "[data-home-hint]"),
      `hint at ${width}x${height} (${await hint.getAttribute("data-hint-place")})`,
    ).toEqual([]);
    const box = await hint.boundingBox();
    expect(box!.y + box!.height, "hint inside the viewport").toBeLessThanOrEqual(height);
    expect(await findOverlappingText(page), "overlapping text").toEqual([]);

    if (closeWith === "Escape") {
      await page.keyboard.press("Escape");
    } else {
      // Its one button: the 44 px x, or the whole one-line pill.
      await hint.getByRole("button", { name: /Dismiss hint/ }).click();
    }
    await expect(hint).toHaveCount(0);
  });
}
