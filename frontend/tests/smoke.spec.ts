import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES = [
  { path: "/", texts: ["Sky ladder"] },
  { path: "/regime", texts: ["Macro atlas", "Method & record"] },
  { path: "/convergence", texts: ["Two events. One macro lens."] },
  { path: "/patterns", texts: ["The 120-year mirror."] },
  { path: "/disclaimer", texts: ["not registered with SEBI"] },
];

for (const route of ROUTES) {
  test(`${route.path} is healthy, readable and accessible`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const usagePosts: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/api/v1/usage")
      ) {
        usagePosts.push(request.url());
      }
    });

    const response = await page.goto(route.path, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    for (const text of route.texts) {
      await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    }

    await page.waitForLoadState("networkidle");

    const accessibility = await new AxeBuilder({ page }).analyze();
    const serious = accessibility.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(serious).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(usagePosts).toEqual([]);
  });
}

test.describe("first-party measurement", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  test("a normal browser posts one batch with only allow-listed fields", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      // Playwright can't read a sendBeacon body in Chromium (and route()
      // misses beacons), so keep a copy in the page and still send it: the
      // batch reaches the real server, and CI then checks it was stored.
      const sink: Promise<string>[] = [];
      (window as unknown as { __beacons: Promise<string>[] }).__beacons = sink;
      const original = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        if (String(url).includes("/api/v1/usage") && data instanceof Blob) {
          sink.push(data.text());
        }
        return original(url, data);
      };
    });
    const beacon = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().includes("/api/v1/usage"),
      { timeout: 15_000 },
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await beacon;
    const bodies = await page.evaluate(() =>
      Promise.all((window as unknown as { __beacons: Promise<string>[] }).__beacons),
    );
    expect(bodies.length).toBeGreaterThan(0);
    const payload = JSON.parse(bodies[0]);
    const allowedTop = new Set([
      "v",
      "aid",
      "sid",
      "new",
      "eph",
      "ctx",
      "exp",
      "ev",
      "vis",
    ]);
    expect(Object.keys(payload).every((key) => allowedTop.has(key))).toBe(true);
    expect(payload.v).toBe(1);
    expect(payload.aid).toHaveLength(22);
    expect(payload.sid).toHaveLength(16);
    expect(Array.isArray(payload.ev)).toBe(true);
    for (const event of payload.ev) {
      expect(["page_viewed", "view_opened"]).toContain(event.n);
      expect(
        Object.keys(event).every((key) =>
          ["n", "t", "pv", "p", "pr"].includes(key),
        ),
      ).toBe(true);
      expect(["page_viewed", "view_opened"]).toContain(event.n);
      if (event.pr && "landing" in event.pr) {
        expect(Object.keys(event.pr).sort()).toEqual(
          expect.arrayContaining(["landing", "nav_type"]),
        );
      }
    }
  });

  test("switching counting off stops every later POST", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/api/v1/usage")) {
        posts.push(request.postData() ?? "");
      }
    });

    await page.goto("/disclaimer", { waitUntil: "domcontentloaded" });
    const control = page.getByRole("switch", { name: "Count my visits" });
    await control.click();
    await expect(control).toHaveAttribute("aria-checked", "false");
    const before = posts.length;
    await page.goto("/patterns", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6_000);
    expect(posts.length).toBe(before);
  });
});

// Review screenshots (uploaded by CI as an artifact): the privacy switch in
// both themes, at desktop and phone width.
test.describe("review screenshots", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const [label, width, height] of [
      ["desktop", 1440, 900],
      ["phone", 390, 844],
    ] as const) {
      test(`/disclaimer privacy section, ${scheme} ${label}`, async ({ page }) => {
        await page.addInitScript((theme) => {
          localStorage.setItem("strikehike-theme", theme);
        }, scheme);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await page.goto("/disclaimer", { waitUntil: "domcontentloaded" });
        const section = page.locator('section[aria-labelledby="privacy-measurement-heading"]');
        await section.scrollIntoViewIfNeeded();
        await expect(page.getByRole("switch", { name: "Count my visits" })).toBeEnabled();
        await page.waitForTimeout(400);
        await section.screenshot({ path: `smoke-screens/disclaimer-${scheme}-${label}.png` });
      });
    }
  }
});

// Through the real Next route and backend (CI runs the backend with the
// store enabled): a stored message answers 204, a link answers 422.
test("feedback reaches the store through the Next route", async ({ request, baseURL }) => {
  const headers = { Origin: new URL(baseURL ?? "http://127.0.0.1:3000").origin };
  const ok = await request.post("/api/v1/feedback", {
    headers,
    data: { message: "Smoke test message", website: "", path: "/", app_version: "smoke01" },
  });
  expect(ok.status()).toBe(204);
  const link = await request.post("/api/v1/feedback", {
    headers,
    data: { message: "see https://example.com", website: "", path: "/", app_version: "smoke01" },
  });
  expect(link.status()).toBe(422);
  expect((await link.json()).detail).toBe("email_or_url");
});
