import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_WEEK = "2099-W01";
const FIXTURE_PATH = join(process.cwd(), "content", "roundups", `${FIXTURE_WEEK}.json`);

const FIXTURE = {
  week: FIXTURE_WEEK,
  start: "2098-12-29",
  end: "2099-01-04",
  generated_at: "2099-01-05T00:00:00.000Z",
  approved: true,
  regime: {
    as_of: "2098-12-31",
    score: 12.3,
    label: "Steady",
    previous_score: 11,
    change: 1.3,
  },
  lines: { regime: "Core Index +12.3 (Steady), +1.3 from last week." },
};

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function mockChangeNoteData(page: Page, week: string | null = FIXTURE_WEEK) {
  await page.route("**/api/v1/regime/macro-history**", async (route) => {
    if (!route.request().url().includes("resolution=monthly")) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        meta: {
          latest_core_index: { date: "2026-11-06", score: 12.5 },
        },
        timeline: [],
        crashes: [],
      }),
    });
  });
  await page.route("**/api/v1/events/upcoming**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        as_of: "2026-11-11",
        themes: {
          Finance: {
            events: [
              {
                event_id: "finance:old",
                name: "Old date",
                theme: "Finance",
                start_date: "2026-12-01",
              },
              {
                event_id: "finance:new",
                name: "New date",
                theme: "Finance",
                start_date: "2026-12-02",
              },
            ],
          },
        },
      }),
    });
  });
  await page.route("**/this-week/latest.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ week }),
    });
  });
}

async function seedReturnVisit(page: Page, days = 3) {
  await page.addInitScript(({ at }) => {
    localStorage.setItem(
      "sh.lastvisit.v1",
      JSON.stringify({
        at,
        score: 10,
        scoreAsOf: "2026-11-01",
        events: ["finance:old"],
      }),
    );
  }, { at: Date.now() - days * 86_400_000 });
}

test.describe("weekly roundup", () => {
  test.beforeAll(async () => {
    await mkdir(join(process.cwd(), "content", "roundups"), {
      recursive: true,
    });
    await writeFile(FIXTURE_PATH, `${JSON.stringify(FIXTURE, null, 2)}\n`, "utf8");
  });

  test.afterAll(async () => {
    await rm(FIXTURE_PATH, { force: true });
  });

  test(
    "approved weeks render; unapproved and unknown weeks 404; RSS, sitemap and OG agree",
    { tag: "@deploy" },
    async ({ page, request }) => {
      const errors = watchErrors(page);
      const approved = await page.goto(`/this-week/${FIXTURE_WEEK}`, {
        waitUntil: "networkidle",
      });
      expect(approved?.status()).toBe(200);
      await expect(page.locator(`[data-roundup="${FIXTURE_WEEK}"]`)).toBeVisible();
      await expect(page.locator("h1")).toContainText("This week: macro + sky");
      await expect(page.locator('[data-share-surface="roundup"]')).toBeVisible();

      const unapproved = await page.goto("/this-week/2026-W46", {
        waitUntil: "networkidle",
      });
      expect(unapproved?.status()).toBe(404);
      const unknown = await page.goto("/this-week/2099-W02", {
        waitUntil: "networkidle",
      });
      expect(unknown?.status()).toBe(404);

      const latest = await page.goto("/this-week", { waitUntil: "networkidle" });
      expect(latest?.status()).toBe(200);
      await expect(page.locator(`[data-roundup="${FIXTURE_WEEK}"]`)).toBeVisible();
      await expect(
        page.locator('link[rel="alternate"][href$="/this-week/rss.xml"]'),
      ).toHaveCount(1);

      const rss = await request.get("/this-week/rss.xml");
      expect(rss.status()).toBe(200);
      expect(rss.headers()["content-type"]).toContain("application/rss+xml");
      const feed = await rss.text();
      expect(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(feed).toContain('<rss version="2.0">');
      expect(feed).toContain("<channel>");
      expect(feed).toContain("<item>");
      expect(feed).toContain(`/this-week/${FIXTURE_WEEK}`);
      expect(feed).not.toContain("/this-week/2026-W46");

      const sitemap = await request.get("/sitemap.xml");
      expect(sitemap.status()).toBe(200);
      const map = await sitemap.text();
      expect(map.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(map).toContain("<urlset");
      expect(map).toContain(`/this-week/${FIXTURE_WEEK}`);
      expect(map).not.toContain("/this-week/2026-W46");

      const html = await (await request.get(`/this-week/${FIXTURE_WEEK}`)).text();
      const og = /property="og:image" content="([^"]+)"/.exec(html)?.[1];
      expect(og).toBeTruthy();
      expect(og).toContain(`/this-week/${FIXTURE_WEEK}/opengraph-image`);
      const image = await request.get(new URL(og!, "http://127.0.0.1:3000").pathname);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toContain("image/png");
      expect(errors.filter((error) => !error.includes("404"))).toEqual([]);
    },
  );
});

test.describe("follow themes", () => {
  test(
    "follow persists across reloads and the page still works when storage throws",
    { tag: "@deploy" },
    async ({ page, browser }) => {
      const errors = watchErrors(page);
      const serverHtml = await (await page.request.get("/upcoming")).text();
      expect(serverHtml).not.toContain('data-your-themes=""');
      expect(serverHtml).not.toContain(">Your themes<");

      await page.goto("/upcoming", { waitUntil: "networkidle" });
      await expect(page.locator("[data-your-themes]")).toHaveCount(0);
      await page.locator('[data-follow-toggle="finance"]:visible').first().click();
      await expect(
        page.locator('[data-follow-toggle="finance"]:visible').first(),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-your-themes]")).toBeVisible();
      expect(
        await page.evaluate(() => localStorage.getItem("sh.follow.v1")),
      ).toBe('["finance"]');

      await page.reload({ waitUntil: "networkidle" });
      await expect(page.locator("[data-your-themes]")).toBeVisible();
      await expect(
        page.locator('[data-follow-toggle="finance"]:visible').first(),
      ).toHaveAttribute("aria-pressed", "true");

      await page.locator("[data-clear-followed]").click();
      await expect(page.locator("[data-your-themes]")).toHaveCount(0);
      expect(
        await page.evaluate(() => localStorage.getItem("sh.follow.v1")),
      ).toBeNull();

      await page.goto("/upcoming/finance", { waitUntil: "networkidle" });
      await page.locator('[data-follow-toggle="finance"]:visible').first().click();
      await expect(
        page.locator('[data-follow-toggle="finance"]:visible').first(),
      ).toHaveAttribute("aria-pressed", "true");
      await page.reload({ waitUntil: "networkidle" });
      await expect(
        page.locator('[data-follow-toggle="finance"]:visible').first(),
      ).toHaveAttribute("aria-pressed", "true");
      expect(errors).toEqual([]);

      const blocked = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      await blocked.addInitScript(() => {
        const fail = () => {
          throw new Error("storage blocked");
        };
        Storage.prototype.getItem = fail;
        Storage.prototype.setItem = fail;
        Storage.prototype.removeItem = fail;
      });
      const blockedPage = await blocked.newPage();
      const blockedErrors = watchErrors(blockedPage);
      await blockedPage.goto("/upcoming", { waitUntil: "networkidle" });
      await blockedPage
        .locator('[data-follow-toggle="finance"]:visible')
        .first()
        .click();
      await expect(
        blockedPage.locator('[data-follow-toggle="finance"]:visible').first(),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(blockedPage.locator("[data-your-themes]")).toBeVisible();
      expect(blockedErrors).toEqual([]);
      await blocked.close();
    },
  );
});

async function firstHref(page: Page, path: string, selector: string) {
  await page.goto(path, { waitUntil: "networkidle" });
  const href = await page.locator(selector).first().getAttribute("href");
  expect(href, `${path} has a link`).toBeTruthy();
  return href!;
}

test.describe("recently viewed", () => {
  test(
    "records the last pages in order and caps the list at eight",
    { tag: "@deploy" },
    async ({ page }) => {
      const errors = watchErrors(page);
      const recession = await firstHref(
        page,
        "/recessions",
        'a[href^="/recessions/"]',
      );
      const decline = await firstHref(
        page,
        "/declines",
        'a[href^="/declines/"]',
      );
      const date = "/dates/2027/fomc-meetings";

      for (const path of [
        "/events/finance~fred_release_dates~50-2026-12",
        recession,
        decline,
        date,
      ]) {
        await page.goto(path, { waitUntil: "networkidle" });
      }
      await page.goto("/upcoming", { waitUntil: "networkidle" });
      const titles = await page
        .locator("[data-recently-viewed] li a")
        .allTextContents();
      expect(titles.length).toBe(4);
      expect(titles[0]).toContain("FOMC");
      expect(titles[3]).toContain("Employment Situation");

      await page.evaluate(() => {
        localStorage.setItem(
          "sh.recent.v1",
          JSON.stringify(
            Array.from({ length: 9 }, (_, index) => ({
              id: `r${index}`,
              kind: "recession",
              title: `Recession ${index}`,
              at: index,
            })),
          ),
        );
      });
      await page.reload({ waitUntil: "networkidle" });
      await expect(page.locator("[data-recently-viewed] li")).toHaveCount(8);
      await page.locator("[data-clear-recent]").click();
      await expect(page.locator("[data-recently-viewed]")).toHaveCount(0);
      expect(errors).toEqual([]);
    },
  );
});

test.describe("retention screenshots", () => {
  test.beforeAll(async () => {
    await mkdir(join(process.cwd(), "content", "roundups"), {
      recursive: true,
    });
    await writeFile(FIXTURE_PATH, `${JSON.stringify(FIXTURE, null, 2)}\n`, "utf8");
  });

  test.afterAll(async () => {
    await rm(FIXTURE_PATH, { force: true });
  });

  test("this-week, followed themes, the change note and recently viewed at 1366 and 390", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const sizes = [
      [1366, 768],
      [390, 844],
    ] as const;

    for (const [width, height] of sizes) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();

      await page.goto(`/this-week/${FIXTURE_WEEK}`, { waitUntil: "networkidle" });
      await page.locator(`[data-roundup="${FIXTURE_WEEK}"]`).waitFor();
      await page.screenshot({
        path: `smoke-screens/this-week-${width}.png`,
        fullPage: true,
      });

      await page.addInitScript(() => {
        localStorage.setItem(
          "sh.follow.v1",
          JSON.stringify(["finance", "science"]),
        );
      });
      await page.goto("/upcoming", { waitUntil: "networkidle" });
      await page.locator("[data-your-themes]").waitFor();
      await page.screenshot({
        path: `smoke-screens/upcoming-followed-${width}.png`,
        fullPage: true,
      });

      const noteContext = await browser.newContext({
        viewport: { width, height },
      });
      const notePage = await noteContext.newPage();
      await seedReturnVisit(notePage);
      await mockChangeNoteData(notePage);
      await notePage.goto("/upcoming", { waitUntil: "networkidle" });
      await notePage.locator('[data-change-note="upcoming"]').waitFor();
      await notePage.screenshot({
        path: `smoke-screens/change-note-upcoming-${width}.png`,
      });

      const homeContext = await browser.newContext({
        viewport: { width, height },
      });
      const home = await homeContext.newPage();
      await seedReturnVisit(home);
      await mockChangeNoteData(home);
      await home.goto("/?orreryProbe=1", { waitUntil: "networkidle" });
      await home.locator("[data-home-change-note]").waitFor();
      await home.waitForTimeout(600);
      await home.screenshot({
        path: `smoke-screens/change-note-home-${width}.png`,
      });

      const recentContext = await browser.newContext({
        viewport: { width, height },
      });
      const recent = await recentContext.newPage();
      await recent.addInitScript(() => {
        localStorage.setItem(
          "sh.recent.v1",
          JSON.stringify([
            {
              id: "finance:fred_release_dates:50-2026-12",
              kind: "event",
              title: "Employment Situation (December 2026)",
              at: Date.now(),
            },
            {
              id: "2027/fomc-meetings",
              kind: "date",
              title: "FOMC meetings 2027",
              at: Date.now() - 1000,
            },
          ]),
        );
      });
      await recent.goto("/upcoming", { waitUntil: "networkidle" });
      await recent.locator("[data-recently-viewed]").waitFor();
      await recent.locator("[data-recently-viewed]").scrollIntoViewIfNeeded();
      await recent.screenshot({
        path: `smoke-screens/recently-viewed-${width}.png`,
      });

      await recentContext.close();
      await homeContext.close();
      await noteContext.close();
      await context.close();
    }
  });
});

test.describe("what changed since your last visit", () => {
  test(
    "first visit is silent; a return visit shows, dismisses, and clears the home orrery",
    { tag: "@deploy" },
    async ({ browser, page }) => {
      test.setTimeout(150_000);
      const firstErrors = watchErrors(page);
      await page.goto("/upcoming", { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      await expect(page.locator("[data-change-note]")).toHaveCount(0);
      expect(firstErrors).toEqual([]);

      const returnContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const returnPage = await returnContext.newPage();
      const returnErrors = watchErrors(returnPage);
      await seedReturnVisit(returnPage);
      await mockChangeNoteData(returnPage);
      await returnPage.goto("/upcoming", { waitUntil: "networkidle" });
      const note = returnPage.locator('[data-change-note="upcoming"]');
      await expect(note).toBeVisible();
      await expect(note).toContainText(
        "The Regime score moved from +10.0 to +12.5.",
      );
      await expect(note).toContainText("One new date was added across all themes.");
      await expect(note.locator('[data-change-note-link=""]')).toHaveAttribute(
        "href",
        "/this-week",
      );
      await returnPage.locator("[data-dismiss-change-note]").click();
      await expect(note).toHaveCount(0);
      expect(returnErrors).toEqual([]);
      await returnContext.close();

      for (const [width, height] of [
        [390, 844],
        [1280, 720],
        [1920, 1080],
      ] as const) {
        const context = await browser.newContext({ viewport: { width, height } });
        const home = await context.newPage();
        const errors = watchErrors(home);
        await seedReturnVisit(home);
        await mockChangeNoteData(home);
        await home.goto("/?orreryProbe=1", { waitUntil: "networkidle" });
        await home.waitForSelector('[data-orrery-ready="true"]', {
          timeout: 30_000,
        });
        const changeNote = home.locator("[data-home-change-note]");
        await expect(changeNote).toBeVisible();
        await home.waitForTimeout(1_200);
        const noteBox = await changeNote.boundingBox();
        const probe = await home.evaluate(
          () =>
            (
              window as unknown as {
                __shOrreryScreen?: {
                  planets: Array<{ name: string; x: number; y: number; r: number }>;
                };
              }
            ).__shOrreryScreen ?? null,
        );
        expect(probe).not.toBeNull();
        for (const planet of probe!.planets) {
          const x = Math.max(
            noteBox!.x,
            Math.min(planet.x, noteBox!.x + noteBox!.width),
          );
          const y = Math.max(
            noteBox!.y,
            Math.min(planet.y, noteBox!.y + noteBox!.height),
          );
          expect(
            Math.hypot(x - planet.x, y - planet.y),
            `${width}: ${planet.name} clears the change note`,
          ).toBeGreaterThanOrEqual(planet.r + 8);
        }
        expect(errors).toEqual([]);
        await context.close();
      }
    },
  );
});
