import { expect, test } from "@playwright/test";
import {
  TEXT_SPACING,
  findClippedText,
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
