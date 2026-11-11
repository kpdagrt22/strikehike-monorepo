import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// P9: the recession and decline reference pages, share cards and copy link.

type Event = { event_id: string; name: string };
type Upcoming = { themes: Record<string, { events: Event[] }> };
const slug = (id: string) => id.replaceAll(":", "~");
const eventPath = (id: string) => `/events/${slug(id)}`;

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function eventPage(request: APIRequestContext) {
  const response = await request.get("/api/v1/events/upcoming?limit_per_theme=100&horizon_days=730");
  expect(response.ok()).toBe(true);
  const payload = (await response.json()) as Upcoming;
  const event = Object.values(payload.themes).flatMap((theme) => theme.events ?? [])[0];
  expect(event).toBeDefined();
  return eventPath(event!.event_id);
}

const PAGES = [
  { name: "recessions index", path: "/recessions", type: "Dataset" },
  { name: "recession detail", path: "/recessions/nber-2007-12", type: "Article" },
  { name: "declines index", path: "/declines", type: "Dataset" },
  {
    name: "decline detail",
    path: "/declines/1929-09-16-1929-crash-great-depression",
    type: "Article",
  },
] as const;

test.describe("reference pages", () => {
  for (const size of [
    [1920, 1080],
    [1366, 768],
    [390, 844],
    [360, 740],
  ] as const) {
    test(`render cleanly at ${size[0]}x${size[1]}`, async ({ page, request }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width: size[0], height: size[1] });
      for (const entry of PAGES) {
        const response = await page.goto(entry.path, { waitUntil: "networkidle" });
        expect(response?.status(), entry.path).toBe(200);

        const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
        expect(canonical, `${entry.path}: canonical`).toContain(entry.path);

        const graph = await page.evaluate(() =>
          [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(
            (node) => {
              const parsed = JSON.parse(node.textContent ?? "{}");
              return parsed["@graph"] ?? [];
            },
          ),
        );
        expect(
          graph.map((node: { "@type"?: string }) => node["@type"]),
          `${entry.path}: JSON-LD type`,
        ).toContain(entry.type);

        await expect(
          page.locator('meta[name="twitter:card"]'),
          `${entry.path}: twitter card`,
        ).toHaveAttribute("content", "summary_large_image");

        const og = await page.locator('meta[property="og:image"]').getAttribute("content");
        expect(og, `${entry.path}: og:image`).toBeTruthy();
        const image = await request.get(new URL(og!).pathname + new URL(og!).search);
        expect(image.status(), `${entry.path}: og image status`).toBe(200);
        expect(image.headers()["content-type"], `${entry.path}: og image type`).toContain(
          "image/png",
        );
      }
      expect(errors).toEqual([]);
    });
  }
});

test.describe("share", () => {
  test("copies each canonical URL, and the selected Regime window", async ({
    page,
    context,
    request,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      // Keep a readable copy of every usage batch (Playwright cannot read a
      // beacon body directly) while still sending it.
      const sink: Promise<string>[] = [];
      (window as unknown as { __shBeacons: Promise<string>[] }).__shBeacons = sink;
      const original = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        if (String(url).includes("/api/v1/usage") && data instanceof Blob) {
          sink.push(data.text());
        }
        return original(url, data);
      };
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: "http://127.0.0.1:3000",
    });
    const event = await eventPage(request);
    const paths = [
      event,
      "/upcoming/finance",
      "/dates/2027/fomc-meetings",
      "/recessions/nber-2007-12",
      "/declines/1929-09-16-1929-crash-great-depression",
    ];

    for (const path of paths) {
      const response = await page.goto(path, { waitUntil: "networkidle" });
      expect(response?.status(), path).toBe(200);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical, `${path}: canonical`).toBeTruthy();
      await page.locator("[data-share-button]").click();
      await expect(page.locator("[data-share-status]")).toHaveText("Link copied");
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied, `${path}: clipboard`).toBe(canonical);
    }

    await page.goto("/regime", { waitUntil: "networkidle" });
    await page.waitForFunction(
      () =>
        /[+-]\d+\.\d/.test(
          document.querySelector("[data-regime-readout]")?.textContent ?? "",
        ),
      { timeout: 25_000 },
    );
    await page.locator("[data-recession-window] button").first().click();
    const selected = await page.evaluate(
      () => new URL(window.location.href).searchParams.get("d"),
    );
    expect(selected).toBeTruthy();
    await page.locator('[data-share-surface="regime"]').click();
    await expect(page.locator("[data-share-status]")).toHaveText("Link copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`https://strikehike.com/regime?d=${selected}`);

    // The batch flushes on the five-second timer: read the copy the page kept.
    await page.waitForTimeout(5_500);
    const bodies = await page.evaluate(() =>
      Promise.all(
        (window as unknown as { __shBeacons: Promise<string>[] }).__shBeacons,
      ),
    );
    expect(
      bodies.some(
        (body) =>
          body.includes('"n":"share_clicked"') &&
          body.includes('"surface":"regime"') &&
          body.includes('"method":"clipboard"'),
      ),
      "share_clicked reaches the analytics batch",
    ).toBe(true);
  });
});

test.describe("reference screenshots", () => {
  for (const [width, height] of [
    [1920, 1080],
    [390, 844],
  ] as const) {
    test(`every reference page at ${width}`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = watchErrors(page);
      await page.addInitScript(() => localStorage.setItem("strikehike-theme", "dark"));
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width, height });

      await page.goto("/recessions", { waitUntil: "networkidle" });
      await page.screenshot({ path: `smoke-screens/recessions-${width}.png` });
      const recessions = await page
        .locator("[data-reference-row] a[href^='/recessions/']")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("href")).filter(Boolean),
        );
      expect(recessions.length).toBeGreaterThan(0);
      for (const href of recessions) {
        await page.goto(href as string, { waitUntil: "domcontentloaded" });
        await expect(page.locator("h1")).toBeVisible();
        await page.screenshot({
          path: `smoke-screens/recession-${(href as string).split("/").pop()}-${width}.png`,
        });
      }

      await page.goto("/declines", { waitUntil: "networkidle" });
      await page.screenshot({ path: `smoke-screens/declines-${width}.png` });
      const declines = await page
        .locator("[data-reference-row] a[href^='/declines/']")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("href")).filter(Boolean),
        );
      expect(declines.length).toBeGreaterThan(0);
      for (const href of declines) {
        await page.goto(href as string, { waitUntil: "domcontentloaded" });
        await expect(page.locator("h1")).toBeVisible();
        await page.screenshot({
          path: `smoke-screens/decline-${(href as string).split("/").pop()}-${width}.png`,
        });
      }
      expect(errors).toEqual([]);
    });
  }
});
