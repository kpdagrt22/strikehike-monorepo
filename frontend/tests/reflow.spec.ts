import { expect, test } from "@playwright/test";

// WCAG 1.4.10 (reflow at 320 px) and 1.4.12 (text spacing). The route list is
// the main families; every route in the sitemap is covered by the launch crawl
// for layout at wider sizes.
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

const TEXT_SPACING = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

for (const route of ROUTES) {
  test(`reflow at 320 with text spacing: ${route}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(route, { waitUntil: "load" });
    await page.addStyleTag({ content: TEXT_SPACING });
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      return {
        viewport: window.innerWidth,
        root: root.scrollWidth,
        body: body.scrollWidth,
      };
    });
    expect(
      overflow.root,
      `${route} root ${overflow.root} > viewport ${overflow.viewport}`,
    ).toBeLessThanOrEqual(overflow.viewport + 1);
    expect(
      overflow.body,
      `${route} body ${overflow.body} > viewport ${overflow.viewport}`,
    ).toBeLessThanOrEqual(overflow.viewport + 1);

    const clipped = await page.evaluate(() => {
      const found: string[] = [];
      for (const element of document.querySelectorAll(
        "p, h1, h2, h3, li, a, button, span",
      )) {
        const style = getComputedStyle(element);
        if (style.overflowX === "visible") continue;
        if (style.overflowX === "auto" || style.overflowX === "scroll") continue;
        if (element.closest('[aria-hidden="true"]')) continue;
        if (element.classList.contains("truncate")) continue;
        if (style.textOverflow === "ellipsis") continue;
        if ((element.textContent ?? "").trim().length < 3) continue;
        if (element.clientWidth < 2) continue;
        if (element.scrollWidth > element.clientWidth + 2) {
          found.push(
            `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} "${(element.textContent ?? "").trim().slice(0, 30)}" ${element.scrollWidth}>${element.clientWidth} ov=${style.overflowX}`,
          );
        }
      }
      return found.slice(0, 5);
    });
    expect(clipped, `${route} clipped text`).toEqual([]);
  });
}
