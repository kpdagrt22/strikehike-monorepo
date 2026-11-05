import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

type UpcomingEvent = {
  event_id: string;
  name: string;
  theme: string;
  start_date: string;
  start_time: string | null;
  start_utc: string | null;
  timezone: string | null;
  all_day: boolean;
  days_until: number;
};

type UpcomingTheme = {
  total_available: number;
  events: UpcomingEvent[];
};

type UpcomingPayload = {
  themes: Record<string, UpcomingTheme>;
};

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

async function waitForUpcoming(request: APIRequestContext) {
  await expect
    .poll(
      async () => {
        const html = await (await request.get("/upcoming")).text();
        const count = /data-upcoming-count="([1-9]\d*)"/.exec(html);
        return count ? Number(count[1]) : 0;
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBeGreaterThan(0);
}

async function fetchUpcoming(request: APIRequestContext): Promise<UpcomingPayload> {
  const response = await request.get(
    "/api/v1/events/upcoming?limit_per_theme=100&horizon_days=365",
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as UpcomingPayload;
}

function firstListedEvent(payload: UpcomingPayload) {
  for (const [theme, entry] of Object.entries(payload.themes)) {
    if (theme === "Politics" || theme === "Natural Disasters") continue;
    if (entry.events[0]) return entry.events[0];
  }
  throw new Error("the fixture has no upcoming event");
}

function firstTimedEvent(payload: UpcomingPayload) {
  for (const [theme, entry] of Object.entries(payload.themes)) {
    if (theme === "Politics" || theme === "Natural Disasters") continue;
    const event = entry.events.find(
      (item) => !item.all_day && Boolean(item.start_utc),
    );
    if (event) return event;
  }
  throw new Error("the fixture has no timed upcoming event");
}

function localDate(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(instant));
}

function localTime(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(instant));
}

function zoneLabel(instant: string, timeZone: string) {
  if (timeZone === "Asia/Kolkata") return "IST";
  const locale = timeZone.startsWith("Europe/") ? "en-GB" : "en-US";
  const parts = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
    timeZoneName: "short",
  }).formatToParts(new Date(instant));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

async function assertHomeUpcoming(page: Page, request: APIRequestContext) {
  const response = await request.get("/api/v1/events/upcoming");
  const data = (await response.json()) as UpcomingPayload;
  const canonical = ["Science", "Finance", "Culture/Religion"];
  const expected = Object.entries(data.themes)
    .filter(
      ([name, entry]) =>
        name !== "Politics" &&
        name !== "Natural Disasters" &&
        entry.total_available > 0,
    )
    .sort(
      ([leftName, left], [rightName, right]) =>
        right.total_available - left.total_available ||
        canonical.indexOf(leftName) - canonical.indexOf(rightName),
    )
    .map(([name]) => name);
  expect(expected.length).toBeGreaterThan(0);

  const panel = page.locator("#chrono-ladder-sheet");
  const headings = panel.locator('h3[id^="upcoming-"]');
  await expect(headings.first()).toBeVisible({ timeout: 30_000 });
  expect((await headings.allTextContents()).map((text) => text.trim())).toEqual(
    expected,
  );
  await expect(panel.getByText("Politics", { exact: true })).toHaveCount(0);
  await expect(
    panel.getByRole("link", { name: /All upcoming dates/ }),
  ).toHaveAttribute("href", "/upcoming");
}

test.describe("home Upcoming loads", () => {
  test("desktop", async ({ page, request }) => {
    await waitForUpcoming(request);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem("hasSeenIntro", "1");
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Upcoming", exact: true }).click();
    await expect(
      page.locator('h3[id^="upcoming-"]').first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("phone", async ({ page, request }) => {
    await waitForUpcoming(request);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript(() => {
      localStorage.setItem("hasSeenIntro", "1");
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator("#chrono-dock-archive").click();
    await page.locator("#chrono-archive-to-ladder").click();
    await page.getByRole("button", { name: "Upcoming", exact: true }).click();
    await expect(
      page.locator('h3[id^="upcoming-"]').first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("This page couldn't load")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe("upcoming calendar", () => {
  test("the server HTML carries events without JavaScript", async ({ request }) => {
    await waitForUpcoming(request);
    const data = await fetchUpcoming(request);
    const event = firstListedEvent(data);
    const response = await request.get("/upcoming");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(event.name);
    const count = /data-upcoming-count="([1-9]\d*)"/.exec(html);
    expect(count).not.toBeNull();
    expect(Number(count![1])).toBeGreaterThan(0);
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

test.describe("local time zones", () => {
  test.describe("Asia/Kolkata", () => {
    test.use({ timezoneId: "Asia/Kolkata" });

    test("a timed row uses the visitor's date, time and label", async ({
      page,
      request,
    }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await waitForUpcoming(request);
      const data = await fetchUpcoming(request);
      const event = firstTimedEvent(data);
      const instant = event.start_utc!;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/upcoming", { waitUntil: "networkidle" });

      const row = page
        .getByRole("listitem")
        .filter({ hasText: event.name })
        .first();
      await expect(row).toContainText(localDate(instant, "Asia/Kolkata"));
      await expect(row).toContainText(
        `${localTime(instant, "Asia/Kolkata")} IST`,
      );
      await expect(row.locator("time")).toHaveAttribute(
        "title",
        new RegExp(`${instant.slice(11, 16)} UTC`),
      );
      expect(errors).toEqual([]);
    });
  });

  test.describe("America/New_York", () => {
    test.use({ timezoneId: "America/New_York" });

    test("a timed row uses Eastern time", async ({ page, request }) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await waitForUpcoming(request);
      const data = await fetchUpcoming(request);
      const event = firstTimedEvent(data);
      const instant = event.start_utc!;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/upcoming", { waitUntil: "networkidle" });

      const row = page
        .getByRole("listitem")
        .filter({ hasText: event.name })
        .first();
      await expect(row).toContainText(
        `${localTime(instant, "America/New_York")} ${zoneLabel(
          instant,
          "America/New_York",
        )}`,
      );
      expect(errors).toEqual([]);
    });
  });
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

test.describe("home Upcoming review screenshots", () => {
  for (const scheme of ["dark", "light"] as const) {
    test(`desktop 1440 ${scheme}`, async ({ page, request }) => {
      await waitForUpcoming(request);
      await page.addInitScript((theme) => {
        localStorage.setItem("strikehike-theme", theme);
        localStorage.setItem("hasSeenIntro", "1");
      }, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Upcoming", exact: true }).click();
      await assertHomeUpcoming(page, request);
      await page.screenshot({
        path: `smoke-screens/home-upcoming-${scheme}-desktop.png`,
      });
    });

    test(`phone 390 ${scheme}`, async ({ page, request }) => {
      await waitForUpcoming(request);
      await page.addInitScript((theme) => {
        localStorage.setItem("strikehike-theme", theme);
        localStorage.setItem("hasSeenIntro", "1");
      }, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/", { waitUntil: "networkidle" });
      await page.locator("#chrono-dock-archive").click();
      await page.locator("#chrono-archive-to-ladder").click();
      await page.getByRole("button", { name: "Upcoming", exact: true }).click();
      await assertHomeUpcoming(page, request);
      await page.screenshot({
        path: `smoke-screens/home-upcoming-${scheme}-phone.png`,
      });
    });
  }
});

test.describe("Kolkata review screenshot", () => {
  test.use({ timezoneId: "Asia/Kolkata" });

  test("/upcoming light phone", async ({ page, request }) => {
    await waitForUpcoming(request);
    await page.addInitScript(() => {
      localStorage.setItem("strikehike-theme", "light");
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/upcoming", { waitUntil: "networkidle" });
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
      path: "smoke-screens/upcoming-kolkata-phone.png",
      fullPage: true,
    });
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
