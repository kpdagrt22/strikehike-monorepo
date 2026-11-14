import { expect, test, type Page } from "@playwright/test";

// P14 launch checks. Three of these are tagged @deploy so they run in the smoke
// gate; the rest run in the full suite. Every expectation reads what the running
// site serves, never a hard-coded count beyond the things this release pinned:
// the published 9–15 Nov roundup, Politics being hidden (D-12), and /about.

const ROUNDUP_WEEK = "2026-W46";

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test.describe("P14: the roundup is published", () => {
  test(
    "the 9–15 Nov week renders, and RSS and the sitemap list it",
    { tag: "@deploy" },
    async ({ page, request }) => {
      const errors = watchErrors(page);

      const response = await page.goto(`/this-week/${ROUNDUP_WEEK}`, {
        waitUntil: "networkidle",
      });
      expect(response?.status()).toBe(200);
      await expect(page.locator(`[data-roundup="${ROUNDUP_WEEK}"]`)).toBeVisible();
      await expect(page.locator("h1")).toContainText("Week of ");

      const rss = await request.get("/this-week/rss.xml");
      expect(rss.status()).toBe(200);
      const feed = await rss.text();
      expect(feed).toContain(`/this-week/${ROUNDUP_WEEK}`);

      const sitemap = await request.get("/sitemap.xml");
      expect(sitemap.status()).toBe(200);
      const map = await sitemap.text();
      expect(map).toContain(`/this-week/${ROUNDUP_WEEK}`);

      expect(errors).toEqual([]);
    },
  );

  test("the week page carries an og:image that is a PNG", async ({ request }) => {
    const html = await (await request.get(`/this-week/${ROUNDUP_WEEK}`)).text();
    const og = /property="og:image" content="([^"]+)"/.exec(html)?.[1];
    expect(og).toBeTruthy();
    const image = await request.get(new URL(og!, "http://127.0.0.1:3000").pathname);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
  });
});

test.describe("P14: Politics is hidden (D-12)", () => {
  test(
    "no page, no feed, no chip, no sitemap entry, and old saved follows are ignored",
    { tag: "@deploy" },
    async ({ page, request }) => {
      // The 404 navigations below are the point of the test, so errors are only
      // watched on the real page.
      for (const path of ["/upcoming/politics", "/upcoming/natural-disasters"]) {
        const response = await page.goto(path, { waitUntil: "domcontentloaded" });
        expect(response?.status(), path).toBe(404);
      }
      expect((await request.get("/calendar/politics.ics")).status()).toBe(404);

      const sitemap = await (await request.get("/sitemap.xml")).text();
      expect(sitemap).not.toContain("politics");
      expect(sitemap).not.toContain("natural-disasters");

      // A follow saved by an older build must not resurrect the theme: seed it
      // before the page loads, then check the page and the pre-paint attribute.
      const errors = watchErrors(page);
      await page.addInitScript((key) => {
        localStorage.setItem(key, JSON.stringify(["politics"]));
      }, "sh.follow.v1");
      await page.goto("/upcoming", { waitUntil: "networkidle" });
      await expect(page.locator('[data-follow-toggle="politics"]')).toHaveCount(0);
      await expect(page.locator('a[href="/upcoming/politics"]')).toHaveCount(0);
      await expect(page.locator("[data-your-themes]")).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          document.documentElement.hasAttribute("data-follows"),
        ),
      ).toBe(false);
      expect(errors).toEqual([]);
    },
  );

  test("the three visible themes keep their pages and toggles", async ({ page }) => {
    await page.goto("/upcoming", { waitUntil: "networkidle" });
    await expect(
      page.locator('[data-follow-toggle="finance"]:visible').first(),
    ).toBeVisible();
    await expect(page.locator('a[href="/upcoming/finance"]:visible').first()).toBeVisible();
    expect((await page.goto("/upcoming/science", { waitUntil: "networkidle" }))?.status()).toBe(
      200,
    );
  });
});

test.describe("P14: About", () => {
  test(
    "renders server-side, is in the sitemap, and the footer links to it",
    { tag: "@deploy" },
    async ({ page, request }) => {
      const errors = watchErrors(page);

      const response = await page.goto("/about", { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveText("About StrikeHike");
      // The page names the owner and the privacy switch: facts, not new claims.
      await expect(
        page.getByRole("heading", { name: "Privacy", exact: true }),
      ).toBeVisible();

      const sitemap = await (await request.get("/sitemap.xml")).text();
      expect(sitemap).toContain("/about");

      // The footer of a scrolling page carries the About link (the home page
      // keeps it in its About panel instead).
      await page.goto("/disclaimer", { waitUntil: "networkidle" });
      await expect(page.locator('footer a[href="/about"]')).toBeVisible();

      expect(errors).toEqual([]);
    },
  );
});
