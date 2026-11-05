import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const ROUTES = [
  { path: "/", texts: ["Sky ladder"] },
  { path: "/regime", texts: ["Macro atlas", "Method & record"] },
  { path: "/convergence", texts: ["Two events. One macro lens."] },
  { path: "/patterns", texts: ["The 120-year mirror."] },
  { path: "/disclaimer", texts: ["not registered with SEBI"] },
  { path: "/upcoming", texts: ["Upcoming dates"] },
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

async function waitForUpcoming(request: {
  get: (url: string) => Promise<{ text: () => Promise<string> }>;
}) {
  await expect
    .poll(async () => (await request.get("/upcoming")).text(), {
      timeout: 60_000,
      intervals: [1_000, 2_000, 3_000],
    })
    .toContain("Employment Situation");
}

test.describe("upcoming calendar", () => {
  test("the server HTML carries events without JavaScript", async ({ request }) => {
    await waitForUpcoming(request);
    const response = await request.get("/upcoming");
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Employment Situation");
  });

  test("Show all opens and a subscribe link points at the feed", async ({ page, request }) => {
    await waitForUpcoming(request);
    await page.goto("/upcoming", { waitUntil: "domcontentloaded" });
    const details = page.locator("details").filter({ hasText: "Show all" }).first();
    await expect(details).toBeVisible();
    await details.locator("summary").click();
    await expect(details).toHaveJSProperty("open", true);

    await page.getByRole("button", { name: "Subscribe to all" }).click();
    const download = page.getByRole("link", { name: "Download .ics" });
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute("href", /\/calendar\/all\.ics$/);
  });

  test("the count matches the listed events and Show all reveals the rest", async ({
    page,
    request,
  }) => {
    await waitForUpcoming(request);
    await page.goto("/upcoming", { waitUntil: "networkidle" });
    const heading = page.getByRole("heading", { level: 2, name: /^Finance/ });
    await expect(heading).toContainText("Finance (62)");
    const section = page.locator("section").filter({ has: heading });
    await expect(section.locator("li:visible")).toHaveCount(5);
    const details = section.locator("details");
    await expect(details.locator("summary")).toContainText("Show all 62");
    await details.locator("summary").click();
    await expect(details).toHaveJSProperty("open", true);
    await expect(section.locator("li:visible")).toHaveCount(62);
  });

  test("the finance feed is a calendar", async ({ request }) => {
    const response = await request.get("/calendar/finance.ics");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/calendar");
    expect(await response.text()).toContain("BEGIN:VCALENDAR\r\n");
    const etag = response.headers()["etag"];
    expect(etag).toBeTruthy();
    const cached = await request.get("/calendar/finance.ics", {
      headers: { "if-none-match": etag },
    });
    expect(cached.status()).toBe(304);
  });
});

test.describe("subscribe menus", () => {
  for (const width of [320, 390, 1440]) {
    test(`stay inside the viewport at ${width}px`, async ({ page, request }) => {
      await waitForUpcoming(request);
      const height = width === 1440 ? 900 : 844;
      await page.setViewportSize({ width, height });
      await page.goto("/upcoming", { waitUntil: "networkidle" });

      const triggers = page.locator("[data-subscribe-trigger]");
      const count = await triggers.count();
      expect(count).toBeGreaterThan(1);

      for (let index = 0; index < count; index += 1) {
        const trigger = triggers.nth(index);
        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();
        const menu = page.locator("[data-subscribe-menu]");
        await expect(menu).toBeVisible();
        const first = menu.locator("a, button").first();
        await expect(first).toBeFocused();

        for (const item of await menu.locator("a, button").all()) {
          const box = await item.boundingBox();
          expect(box).not.toBeNull();
          expect(box!.height).toBeGreaterThanOrEqual(43.5);
        }

        const box = await menu.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(15.5);
        expect(box!.y).toBeGreaterThanOrEqual(15.5);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width - 15.5);
        expect(box!.y + box!.height).toBeLessThanOrEqual(height - 15.5);

        await page.keyboard.press("Escape");
        await expect(menu).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    });
  }

  test("an outside tap closes the menu", async ({ page, request }) => {
    await waitForUpcoming(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/upcoming", { waitUntil: "networkidle" });
    await page.locator('[data-subscribe-trigger="all"]').click();
    const menu = page.locator('[data-subscribe-menu="all"]');
    await expect(menu).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(menu).toBeHidden();
  });

  for (const scheme of ["dark", "light"] as const) {
    test(`both menus on phone, ${scheme}`, async ({ page, request }) => {
      await waitForUpcoming(request);
      await page.addInitScript((theme) => {
        localStorage.setItem("strikehike-theme", theme);
      }, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/upcoming", { waitUntil: "networkidle" });

      await page.locator('[data-subscribe-trigger="all"]').click();
      await expect(page.locator('[data-subscribe-menu="all"]')).toBeVisible();
      await page.screenshot({
        path: `smoke-screens/upcoming-subscribe-all-${scheme}-phone.png`,
      });
      await page.keyboard.press("Escape");

      const finance = page.locator('[data-subscribe-trigger="finance"]');
      await finance.scrollIntoViewIfNeeded();
      await finance.click();
      await expect(page.locator('[data-subscribe-menu="finance"]')).toBeVisible();
      await page.screenshot({
        path: `smoke-screens/upcoming-subscribe-finance-${scheme}-phone.png`,
      });
    });
  }
});

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

// Review screenshots (uploaded by CI as an artifact): /upcoming in both
// themes at desktop and phone width, and its Subscribe menu on a phone.
test.describe("upcoming review screenshots", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const [label, width, height] of [
      ["desktop", 1440, 900],
      ["phone", 390, 844],
    ] as const) {
      test(`/upcoming ${scheme} ${label}`, async ({ page, request }) => {
        await waitForUpcoming(request);
        await page.addInitScript((theme) => {
          localStorage.setItem("strikehike-theme", theme);
        }, scheme);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await page.goto("/upcoming", { waitUntil: "networkidle" });
        // The engine layout scrolls inside <main>; let the screenshot show the
        // whole page instead of one viewport.
        await page.evaluate(() => {
          const main = document.querySelector("main");
          if (!main) return;
          main.style.height = "auto";
          main.style.overflow = "visible";
          const shell = main.parentElement;
          if (shell) {
            shell.style.height = "auto";
            shell.style.overflow = "visible";
          }
          document.documentElement.style.height = "auto";
          document.body.style.height = "auto";
          document.body.style.overflow = "visible";
        });
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `smoke-screens/upcoming-${scheme}-${label}.png`,
          fullPage: true,
        });
      });
    }
  }

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
