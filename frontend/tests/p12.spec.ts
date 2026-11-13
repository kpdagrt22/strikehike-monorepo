import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

// P12-D: the /tested explainers, the three P12-0 polish fixes, the experiment
// flags and the site-wide support block.

const SIZES = [
  [1366, 768],
  [390, 844],
] as const;

const CLAIMS = ["mercury-retrograde", "full-moon", "eclipses"] as const;

// Usage batches are kept in sessionStorage, which survives the navigations
// inside one test; Playwright cannot read a beacon body directly.
const BEACON_LOG = "__shBeaconLog";

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

// Analytics only runs for a real browser, and Playwright reports itself as a
// webdriver, so these tests opt back in and read every batch they send.
async function allowAnalytics(context: BrowserContext) {
  await context.addInitScript((key: string) => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    const original = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      if (String(url).includes("/api/v1/usage") && data instanceof Blob) {
        void data.text().then((text) => {
          try {
            sessionStorage.setItem(key, (sessionStorage.getItem(key) ?? "") + text + "\n");
          } catch {
            // A blocked sessionStorage just means no log to read.
          }
        });
      }
      return original(url, data);
    };
  }, BEACON_LOG);
}

async function beacons(page: Page) {
  return page.evaluate((key) => sessionStorage.getItem(key) ?? "", BEACON_LOG);
}

function occurrences(body: string, needle: string) {
  return body.split(needle).length - 1;
}

async function jsonLdTypes(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('script[type="application/ld+json"]')]
      .flatMap((node) => {
        const parsed = JSON.parse(node.textContent ?? "{}") as {
          "@graph"?: Array<{ "@type"?: string | string[] }>;
        };
        return parsed["@graph"] ?? [];
      })
      .flatMap((node) => (Array.isArray(node["@type"]) ? node["@type"] : node["@type"] ?? [])),
  );
}

type ClaimJson = {
  id: string;
  title: string;
  result: string;
  result_code: string;
  method: string[];
};

async function claimJson(id: string): Promise<ClaimJson> {
  const raw = await readFile(join(process.cwd(), "content", "tested", `${id}.json`), "utf8");
  return JSON.parse(raw) as ClaimJson;
}

test.describe("claim tests", () => {
  test(
    "the three claim pages and the index render, match their JSON, and ship SEO",
    { tag: "@deploy" },
    async ({ page, request }) => {
      const errors = watchErrors(page);

      const index = await page.goto("/tested", { waitUntil: "networkidle" });
      expect(index?.status()).toBe(200);
      await expect(page.locator("h1")).toContainText("Popular claims");
      for (const id of CLAIMS) {
        await expect(page.locator(`[data-claim-card="${id}"]`)).toBeVisible();
      }
      expect(await jsonLdTypes(page)).toContain("Dataset");

      for (const id of CLAIMS) {
        const data = await claimJson(id);
        const response = await page.goto(`/tested/${id}`, { waitUntil: "networkidle" });
        expect(response?.status(), id).toBe(200);

        // The result sentence is the one the builder wrote, keyed by its code.
        await expect(page.locator(`[data-claim-result="${data.result_code}"]`)).toHaveText(
          data.result,
        );
        // The numbers table and the permutation line.
        await expect(page.locator("[data-claim-table]")).toBeVisible();
        await expect(page.locator("[data-claim-stats]")).toContainText("permutation p =");
        // The method box lists every choice the builder recorded.
        for (const line of data.method) {
          await expect(page.locator("body")).toContainText(line);
        }
        // The window list stays collapsed until asked for.
        const details = page.locator("details", { has: page.locator("[data-claim-windows]") });
        await expect(details).toHaveCount(1);
        await expect(page.locator("[data-claim-windows]")).toBeHidden();
        await details.locator("summary").click();
        await expect(page.locator("[data-claim-windows]")).toBeVisible();
        // JSON-LD, share surface and cross-links.
        expect(await jsonLdTypes(page)).toContain("Article");
        await expect(page.locator('[data-share-surface="tested"]')).toBeVisible();
        await expect(page.locator('a[href="/declines"]').first()).toBeVisible();
        await expect(page.locator('a[href="/regime"]').first()).toBeVisible();

        const og = await page.locator('meta[property="og:image"]').getAttribute("content");
        expect(og, `${id}: og:image`).toBeTruthy();
        const image = await request.get(new URL(og!).pathname);
        expect(image.status(), `${id}: og image`).toBe(200);
        expect(image.headers()["content-type"]).toContain("image/png");
      }

      const sitemap = await request.get("/sitemap.xml");
      expect(sitemap.status()).toBe(200);
      const map = await sitemap.text();
      expect(map).toContain("/tested<");
      for (const id of CLAIMS) expect(map).toContain(`/tested/${id}`);

      expect(errors).toEqual([]);
    },
  );
});

test.describe("experiments", () => {
  test(
    "control by default, ?exp forces a variant, one exposure per session, nothing while inactive",
    { tag: "@deploy" },
    async ({ browser, request }) => {
      // The server HTML always carries the control label, so every visitor gets
      // the same first paint and hydration matches.
      const html = await (await request.get("/")).text();
      expect(html).toContain("See 170 years of markets beside the sky");

      // Not live: a normal load serves control and reports no exposure.
      const controlContext = await browser.newContext();
      await allowAnalytics(controlContext);
      const control = await controlContext.newPage();
      const controlErrors = watchErrors(control);
      await control.goto("/", { waitUntil: "domcontentloaded" });
      await expect(control.locator("[data-home-cta]")).toHaveAttribute(
        "data-exp-variant",
        "control",
      );
      await expect(control.locator("[data-home-cta]")).toContainText(
        "See 170 years of markets beside the sky",
      );
      await control.waitForTimeout(5_500);
      const controlLog = await beacons(control);
      // Analytics really ran, so the negative check below is not vacuous.
      expect(controlLog).toContain('"n":"page_viewed"');
      expect(controlLog).not.toContain('"n":"experiment_exposed"');
      expect(controlErrors).toEqual([]);
      await controlContext.close();

      // ?exp forces the record variant and reports one exposure. A second load
      // in the same session reports nothing more.
      const expContext = await browser.newContext();
      await allowAnalytics(expContext);
      const page = await expContext.newPage();
      const errors = watchErrors(page);
      await page.goto("/?exp=home-cta:record", { waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-home-cta]")).toHaveAttribute(
        "data-exp-variant",
        "record",
      );
      await expect(page.locator("[data-home-cta]")).toContainText("Explore the market record");
      await page.waitForTimeout(5_500);
      await page.goto("/?exp=home-cta:record", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5_500);
      const log = await beacons(page);
      expect(occurrences(log, '"n":"experiment_exposed"')).toBe(1);
      expect(log).toContain('"exp":"home-cta"');
      expect(log).toContain('"variant":"record"');
      expect(errors).toEqual([]);
      await expContext.close();
    },
  );
});

test.describe("support block", () => {
  const PAGES = ["/regime", "/declines", "/tested", "/disclaimer"] as const;

  test(
    "the footer support block fits at 390 and 1366 and reports the footer surface",
    { tag: "@deploy" },
    async ({ browser }) => {
      const errors: string[] = [];
      for (const [width, height] of SIZES) {
        const context = await browser.newContext({ viewport: { width, height } });
        await allowAnalytics(context);
        await context.route("**paypal.me/**", (route) =>
          route.fulfill({ status: 204, body: "" }),
        );
        const page = await context.newPage();
        page.on("popup", (popup) => popup.close().catch(() => {}));
        const pageErrors = watchErrors(page);

        for (const path of PAGES) {
          const response = await page.goto(path, { waitUntil: "networkidle" });
          expect(response?.status(), `${path}@${width}`).toBe(200);
          const block = page.locator("[data-support-block]");
          await block.scrollIntoViewIfNeeded();
          await expect(block).toBeVisible();
          await expect(block).toContainText("Support StrikeHike");
          await expect(block).toContainText("No ads, no tracking cookies.");
          await expect(block.locator('[data-support-link="footer"]')).toHaveAttribute(
            "href",
            "https://paypal.me/kpdagrt22",
          );
          const overflow = await page.evaluate(
            () =>
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
          );
          expect(overflow, `${path}@${width}: horizontal scroll`).toBeLessThanOrEqual(1);
        }

        // The footer link is the block's only affordance, so it reports both
        // the support action and the link click, with surface "footer".
        await page.goto(PAGES[2], { waitUntil: "networkidle" });
        const link = page.locator('[data-support-link="footer"]').first();
        await link.scrollIntoViewIfNeeded();
        await link.click();
        await page.waitForTimeout(5_500);
        const log = await beacons(page);
        expect(log).toContain('"n":"support_opened"');
        expect(log).toContain('"n":"support_link_clicked"');
        expect(log).toContain('"surface":"footer"');

        errors.push(...pageErrors);
        await context.close();
      }
      expect(errors).toEqual([]);
    },
  );
});

// The P12-0 polish: a single readable Regime line, dates that never break, and
// change-note counts written as words.

const FIXTURES: Record<string, unknown> = {
  "2098-W40": {
    week: "2098-W40",
    start: "2098-09-28",
    end: "2098-10-04",
    generated_at: "2098-10-05T00:00:00.000Z",
    approved: true,
    regime: {
      as_of: "2098-10-01",
      score: 12.3,
      label: "Steady",
      previous_score: 11,
      change: 1.3,
    },
    lines: { regime: "Core Index +12.3 (Steady), +1.3 from last week." },
  },
  "2098-W41": {
    week: "2098-W41",
    start: "2098-10-05",
    end: "2098-10-11",
    generated_at: "2098-10-12T00:00:00.000Z",
    approved: true,
    regime: {
      as_of: "2098-09-20",
      score: 10,
      label: "Steady",
      previous_score: null,
      change: null,
    },
    lines: { regime: "Core Index +10.0 (Steady), unchanged." },
  },
};

const ROUNDUP_DIR = join(process.cwd(), "content", "roundups");

test.beforeAll(async () => {
  await mkdir(ROUNDUP_DIR, { recursive: true });
  for (const [week, body] of Object.entries(FIXTURES)) {
    await writeFile(join(ROUNDUP_DIR, `${week}.json`), `${JSON.stringify(body, null, 2)}\n`, "utf8");
  }
});

test.afterAll(async () => {
  for (const week of Object.keys(FIXTURES)) {
    await rm(join(ROUNDUP_DIR, `${week}.json`), { force: true });
  }
});

async function seedFollow(page: Page, themes = ["finance", "science"]) {
  await page.addInitScript((value) => {
    localStorage.setItem("sh.follow.v1", JSON.stringify(value));
  }, themes);
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

async function mockChangeNote(page: Page, newDates: number) {
  await page.route("**/api/v1/regime/macro-history**", async (route) => {
    if (!route.request().url().includes("resolution=monthly")) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        meta: { latest_core_index: { date: "2026-11-06", score: 12.5 } },
        timeline: [],
        crashes: [],
      }),
    });
  });
  await page.route("**/api/v1/events/upcoming**", async (route) => {
    const events = [{ event_id: "finance:old", name: "Old date", theme: "Finance", start_date: "2026-12-01" }];
    for (let index = 0; index < newDates; index += 1) {
      events.push({
        event_id: `finance:new${index}`,
        name: `New date ${index}`,
        theme: "Finance",
        start_date: `2026-12-0${index + 2}`,
      });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ as_of: "2026-11-11", themes: { Finance: { events } } }),
    });
  });
  await page.route("**/this-week/latest.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ week: "2099-W01" }),
    });
  });
}

test.describe("P12-0 polish", () => {
  test("the roundup Regime line shows once, with a readable date", async ({ page }) => {
    const errors = watchErrors(page);

    await page.goto("/this-week/2098-W40", { waitUntil: "networkidle" });
    const fresh = page.locator('section[aria-labelledby="roundup-regime"]');
    await expect(fresh).toHaveCount(1);
    // The reading is a stat card: the score, its label and its change, each once.
    await expect(fresh).toContainText("Steady");
    await expect(fresh).toContainText("+1.3 from the week before");
    await expect(fresh).toContainText(/Latest reading: week of \w{3},? \d{1,2} \w{3} 2098\./);
    expect(
      occurrences(await fresh.innerText(), "+12.3"),
      "the score appears once",
    ).toBe(1);

    // A reading more than a week before the roundup names its own week.
    await page.goto("/this-week/2098-W41", { waitUntil: "networkidle" });
    const stale = page.locator('section[aria-labelledby="roundup-regime"]');
    await expect(stale).toContainText(/\(from 2098-W\d{2}, before 2098-W41\)/);
    expect(errors).toEqual([]);
  });

  test("Your themes dates read as 'Fri 4 Dec' and stay on one line", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await seedFollow(page);
    const errors = watchErrors(page);

    await page.goto("/upcoming", { waitUntil: "networkidle" });
    const themes = page.locator("[data-your-themes]");
    await expect(themes).toBeVisible();
    const dates = themes.locator("span.whitespace-nowrap");
    await expect(dates.first()).toBeVisible();

    const texts = await dates.allInnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text, text).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
    }
    // One client rect means one line: the date never breaks across lines.
    expect(await dates.first().evaluate((el) => el.getClientRects().length)).toBe(1);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("the change note writes counts as words", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await seedReturnVisit(page);
    await mockChangeNote(page, 2);
    const errors = watchErrors(page);

    await page.goto("/upcoming", { waitUntil: "networkidle" });
    const note = page.locator('[data-change-note="upcoming"]');
    await expect(note).toBeVisible();
    await expect(note).toContainText("Two new dates were added across all themes.");
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe("P12 screenshots", () => {
  test("tested pages, the polish fixes and the support block at 1366 and 390", async ({
    browser,
  }) => {
    test.setTimeout(240_000);

    for (const [width, height] of SIZES) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();

      await page.goto("/tested", { waitUntil: "networkidle" });
      await page.screenshot({ path: `smoke-screens/tested-index-${width}.png`, fullPage: true });
      for (const id of CLAIMS) {
        await page.goto(`/tested/${id}`, { waitUntil: "networkidle" });
        await expect(page.locator("h1")).toBeVisible();
        await page.screenshot({ path: `smoke-screens/tested-${id}-${width}.png`, fullPage: true });
      }

      await page.goto("/this-week/2098-W41", { waitUntil: "networkidle" });
      await page
        .locator('section[aria-labelledby="roundup-regime"]')
        .screenshot({ path: `smoke-screens/roundup-regime-${width}.png` });

      await page.goto("/disclaimer", { waitUntil: "networkidle" });
      const support = page.locator("[data-support-block]");
      await support.scrollIntoViewIfNeeded();
      await support.screenshot({ path: `smoke-screens/support-footer-${width}.png` });

      const themesContext = await browser.newContext({ viewport: { width, height } });
      const themesPage = await themesContext.newPage();
      await seedFollow(themesPage);
      await themesPage.goto("/upcoming", { waitUntil: "networkidle" });
      const yourThemes = themesPage.locator("[data-your-themes]");
      await expect(yourThemes).toBeVisible();
      await yourThemes.screenshot({ path: `smoke-screens/your-themes-${width}.png` });
      await themesContext.close();

      const noteContext = await browser.newContext({ viewport: { width, height } });
      const notePage = await noteContext.newPage();
      await seedReturnVisit(notePage);
      await mockChangeNote(notePage, 2);
      await notePage.goto("/upcoming", { waitUntil: "networkidle" });
      const note = notePage.locator('[data-change-note="upcoming"]');
      await expect(note).toBeVisible();
      await note.screenshot({ path: `smoke-screens/change-note-${width}.png` });
      await noteContext.close();

      await context.close();
    }
  });
});
