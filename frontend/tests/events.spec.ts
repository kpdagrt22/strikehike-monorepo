import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { isIndexableEvent, isIndexableTheme } from "../src/lib/events/indexing";
import { YEAR_LISTS, yearListStatus } from "../src/lib/events/yearLists";

// P8: the event, theme and year pages, and the card actions that point at
// them. Every expectation is read from the data the app serves (the backend
// through the Next proxies), never from a hard-coded count, id or date.

type Event = {
  event_id: string;
  name: string;
  theme: string;
  start_date: string;
  start_time: string | null;
  start_utc: string | null;
  timezone: string | null;
  all_day: boolean;
  status: string;
  description?: string | null;
  source_id?: string | null;
  authority_url?: string | null;
};
type Upcoming = {
  as_of: string;
  themes: Record<string, { events: Event[] }>;
};
type Detail = Event & { description: string; kind: string };

const slug = (id: string) => id.replaceAll(":", "~");
const eventPath = (id: string) => `/events/${slug(id)}`;
const eventIcsPath = (id: string) => `/calendar/event/${slug(id)}.ics`;

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function readUpcoming(request: APIRequestContext, horizonDays = 730) {
  const response = await request.get(
    `/api/v1/events/upcoming?limit_per_theme=100&horizon_days=${horizonDays}`,
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as Upcoming;
}

function eventsOf(payload: Upcoming) {
  return Object.values(payload.themes).flatMap((theme) => theme.events ?? []);
}

async function robotsOf(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  const html = await response.text();
  return {
    status: response.status(),
    robots: /<meta name="robots" content="([^"]*)"/.exec(html)?.[1] ?? null,
    title: /<title>(.*?)<\/title>/.exec(html)?.[1] ?? null,
    canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? null,
    ld: [...html.matchAll(/"@type":"([A-Za-z]+)"/g)].map((match) => match[1]),
  };
}

/** A tiny RFC 5545 reader for the single-event file: enough to prove it parses. */
function parseIcs(body: string) {
  expect(body.includes("\r\n")).toBe(true);
  const physical = body.split("\r\n");
  const unfolded: string[] = [];
  for (const line of physical) {
    if (line.startsWith(" ")) unfolded[unfolded.length - 1] += line.slice(1);
    else if (line) unfolded.push(line);
  }
  const keys = unfolded.map((line) => line.slice(0, line.indexOf(":")));
  return {
    begin: unfolded[0],
    end: unfolded.at(-1),
    vevents: unfolded.filter((line) => line === "BEGIN:VEVENT").length,
    keys,
    values: (key: string) =>
      unfolded.filter((line) => line.startsWith(`${key}:`)).map((line) => line.slice(key.length + 1)),
  };
}

test.describe("event pages", () => {
  test("an indexable event renders with index robots and the right JSON-LD", async ({
    page,
    request,
  }) => {
    const events = eventsOf(await readUpcoming(request));
    const indexable = events.find((event) => isIndexableEvent(event).index);
    test.skip(!indexable, "no indexable event in the active bundle");
    const errors = watchErrors(page);

    const response = await page.goto(eventPath(indexable!.event_id), { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveText(indexable!.name);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index/);
    await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute("content", /noindex/);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toContain(eventPath(indexable!.event_id));

    const types = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('script[type="application/ld+json"]')];
      const all = nodes.flatMap((node) => JSON.parse(node.textContent ?? "{}")["@graph"] ?? []);
      return all.map((item: { "@type": string }) => item["@type"]);
    });
    expect(types).toContain("BreadcrumbList");
    expect(types).toContain("WebPage");
    expect(types).not.toContain("Event");

    // The three things a reader comes for.
    await expect(page.getByRole("link", { name: /See the sky on this date/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add to calendar (.ics)" })).toHaveAttribute(
      "href",
      eventIcsPath(indexable!.event_id),
    );
    expect(errors).toEqual([]);
  });

  test("a noindex event says so, and still has its page", async ({ page, request }) => {
    const events = eventsOf(await readUpcoming(request));
    const noindex = events.find((event) => !isIndexableEvent(event).index && event.status === "scheduled");
    test.skip(!noindex, "no scheduled noindex event in the active bundle");

    const response = await page.goto(eventPath(noindex!.event_id), { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator("h1")).toHaveText(noindex!.name);
  });

  test("an unknown event id is a 404", async ({ page }) => {
    const response = await page.goto("/events/science~test~does-not-exist", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Off the timeline.")).toBeVisible();
  });
});

test.describe("theme pages", () => {
  test("finance has a page; politics does not", async ({ page }) => {
    expect((await page.goto("/upcoming/finance", { waitUntil: "networkidle" }))?.status()).toBe(200);
    const missing = await page.goto("/upcoming/politics", { waitUntil: "domcontentloaded" });
    expect(missing?.status()).toBe(404);
  });

  for (const theme of ["science", "finance", "culture-religion"]) {
    test(`${theme}: robots follow isIndexableTheme`, async ({ request }) => {
      const payload = await readUpcoming(request, 365);
      const name = { science: "Science", finance: "Finance", "culture-religion": "Culture/Religion" }[theme]!;
      const count = payload.themes[name]?.events?.length ?? 0;
      const decision = isIndexableTheme({ name, upcoming: count });
      const page = await robotsOf(request, `/upcoming/${theme}`);
      expect(page.status).toBe(200);
      expect(page.robots).toContain(decision.index ? "index" : "noindex");
      expect(page.ld).toContain("BreadcrumbList");
      expect(page.ld).not.toContain("Event");
    });
  }
});

test.describe("year pages", () => {
  for (const list of YEAR_LISTS) {
    test(`${list.year} ${list.slug}: published only when complete`, async ({ request }) => {
      const found = await Promise.all(
        list.entries.map(async (entry) => {
          const response = await request.get(`/api/v1/events/${encodeURIComponent(entry.id)}`);
          if (!response.ok()) return null;
          return (await response.json()) as Detail;
        }),
      );
      const status = yearListStatus(list, found);
      const page = await robotsOf(request, `/dates/${list.year}/${list.slug}`);
      if (!status.complete) {
        expect(page.status, JSON.stringify(status.missing)).toBe(404);
        return;
      }
      expect(page.status).toBe(200);
      expect(page.robots).toContain("index");
      for (const entry of list.entries) {
        expect(await (await request.get(eventPath(entry.id))).status()).toBe(200);
      }
    });
  }
});

test.describe("sitemap", () => {
  test("every URL returns 200, and generated ones are indexable", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locs.length).toBeGreaterThan(0);
    const upcoming = await readUpcoming(request, 365);
    const everything = await readUpcoming(request, 730);
    const byId = new Map(eventsOf(everything).map((event) => [event.event_id, event]));

    for (const loc of locs) {
      const path = new URL(loc).pathname;
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      const html = await response.text();
      const robots = /<meta name="robots" content="([^"]*)"/.exec(html)?.[1] ?? "";
      expect(robots, path).not.toContain("noindex");

      if (path.startsWith("/events/")) {
        const id = decodeURIComponent(path.slice("/events/".length)).replaceAll("~", ":");
        expect(byId.has(id), path).toBe(true);
        expect(isIndexableEvent(byId.get(id)!).index, path).toBe(true);
      } else if (path.startsWith("/upcoming/")) {
        const slugName = path.slice("/upcoming/".length);
        const name = { science: "Science", finance: "Finance", "culture-religion": "Culture/Religion" }[slugName];
        const count = name ? (upcoming.themes[name]?.events?.length ?? 0) : 0;
        expect(isIndexableTheme({ name: slugName, upcoming: count }).index, path).toBe(true);
      }
    }
  });
});

test.describe("card actions", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("hover reveals the actions; keyboard reaches them with a visible focus", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/upcoming", { waitUntil: "networkidle" });
    const container = page.locator("[data-event-actions]").first();
    await expect(container).toHaveCount(1);
    expect(await container.evaluate((element) => getComputedStyle(element).opacity)).toBe("0");
    await container.locator("xpath=ancestor::li[1]").hover();
    await expect
      .poll(() => container.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");

    // Reach the first action with the keyboard alone.
    await page.mouse.move(0, 0);
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    let focused = false;
    for (let step = 0; step < 120 && !focused; step += 1) {
      await page.keyboard.press("Tab");
      focused = await page.evaluate(() =>
        Boolean(document.activeElement?.closest("[data-event-actions]")),
      );
    }
    expect(focused).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.matches(":focus-visible"))).toBe(true);
    await expect
      .poll(() => container.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");

    const label = await page.evaluate(() => document.activeElement?.textContent?.trim());
    if (label === "Event page") {
      await page.keyboard.press("Enter");
      await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/events\//);
    }
    expect(errors).toEqual([]);
  });

  test("touch: always visible, 44 px, and Add to calendar downloads the .ics", async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      await page.goto("/upcoming", { waitUntil: "networkidle" });
      const container = page.locator("[data-event-actions]").first();
      expect(await container.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
      const targets = await container.locator("a").evaluateAll((links) =>
        links.map((link) => Math.round(link.getBoundingClientRect().height)),
      );
      expect(targets.length).toBeGreaterThanOrEqual(2);
      expect(Math.min(...targets)).toBeGreaterThanOrEqual(44);

      const href = await container.getByRole("link", { name: "Add to calendar" }).getAttribute("href");
      expect(href).toMatch(/^\/calendar\/event\/.+\.ics$/);
      const body = await (await request.get(href!)).text();
      const ics = parseIcs(body);
      expect(ics.begin).toBe("BEGIN:VCALENDAR");
      expect(ics.end).toBe("END:VCALENDAR");
      expect(ics.vevents).toBe(1);
      for (const key of ["UID", "DTSTAMP", "DTSTART", "SUMMARY", "STATUS"]) {
        expect(ics.values(key).length, key).toBeGreaterThan(0);
      }

      const download = page.waitForEvent("download");
      await container.getByRole("link", { name: "Add to calendar" }).tap();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/\.ics$/);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("the home Upcoming card travels in place, and its Event page link works", async ({
    page,
  }) => {
    test.skip(
      (await page.viewportSize())!.width < 1024,
      "the home Upcoming panel is a desktop panel",
    );
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Upcoming", exact: true }).click();
    const card = page.locator("[data-event-actions]").first();
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: "See the sky" }).click();
    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).searchParams.get("d")).toBeNull();
    const href = await card.getByRole("link", { name: "Event page" }).getAttribute("href");
    expect(href).toMatch(/^\/events\//);
  });
});

test.describe("card action analytics", () => {
  // A normal browser UA: the tracker ignores HeadlessChrome (track.ts BOT_UA).
  test.use({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  test("See the sky travels to that date; Add to calendar records a download", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      const sink: Promise<string>[] = [];
      (window as unknown as { __beacons: Promise<string>[] }).__beacons = sink;
      const original = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        if (String(url).includes("/api/v1/usage") && data instanceof Blob) sink.push(data.text());
        return original(url, data);
      };
    });
    await page.goto("/upcoming", { waitUntil: "networkidle" });
    const container = page.locator("[data-event-actions]").first();
    const skyHref = await container.getByRole("link", { name: "See the sky" }).getAttribute("href");
    const day = new URL(skyHref!, "https://strikehike.com").searchParams.get("d");
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await container.getByRole("link", { name: "See the sky" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get("d")).toBe(day);
    await page.waitForTimeout(6_000); // the tracker flushes every 5 s
    const bodies = await page.evaluate(() =>
      Promise.all((window as unknown as { __beacons: Promise<string>[] }).__beacons),
    );
    const events = bodies.flatMap((body) => JSON.parse(body).ev ?? []);
    const travelled = events.find((event: { n: string }) => event.n === "date_travelled");
    expect(travelled?.pr).toMatchObject({ method: "archive_event" });

    await page.goto("/upcoming", { waitUntil: "networkidle" });
    const again = page.locator("[data-event-actions]").first();
    await again.getByRole("link", { name: "Add to calendar" }).click();
    await page.waitForTimeout(6_000);
    const bodies2 = await page.evaluate(() =>
      Promise.all((window as unknown as { __beacons: Promise<string>[] }).__beacons),
    );
    const events2 = bodies2.flatMap((body) => JSON.parse(body).ev ?? []);
    const subscribed = events2.filter((event: { n: string }) => event.n === "calendar_subscribed");
    expect(subscribed.length).toBeGreaterThan(0);
    expect(subscribed.at(-1).pr).toMatchObject({ method: "download" });
    expect(["science", "finance", "culture-religion"]).toContain(subscribed.at(-1).pr.scope);
  });
});

test.describe("navigation", () => {
  test("generated pages mark Upcoming as the current view, not Orrery", async ({
    page,
    request,
  }) => {
    const events = eventsOf(await readUpcoming(request));
    const indexable = events.find((event) => isIndexableEvent(event).index) ?? events[0];
    expect(indexable).toBeDefined();
    for (const path of [
      eventPath(indexable!.event_id),
      "/upcoming/finance",
      "/dates/2027/fomc-meetings",
    ]) {
      const response = await page.goto(path, { waitUntil: "networkidle" });
      expect(response?.status(), path).toBe(200);
      await expect(
        page.getByRole("link", { name: "Upcoming", exact: true }).first(),
        path,
      ).toHaveAttribute("aria-current", "page");
      await expect(
        page.getByRole("link", { name: "Orrery", exact: true }).first(),
        path,
      ).not.toHaveAttribute("aria-current", "page");
    }
  });
});

test.describe("review screenshots", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const [label, width, height] of [
      ["1440", 1440, 900],
      ["390", 390, 844],
    ] as const) {
      test(`event, theme, year and a revealed row, ${scheme} ${label}`, async ({
        page,
        request,
      }) => {
        mkdirSync("smoke-screens", { recursive: true });
        await page.addInitScript((theme) => {
          localStorage.setItem("strikehike-theme", theme);
        }, scheme);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });

        const events = eventsOf(await readUpcoming(request));
        const indexable = events.find((event) => isIndexableEvent(event).index) ?? events[0];
        expect(indexable).toBeDefined();

        await page.goto(eventPath(indexable!.event_id), { waitUntil: "networkidle" });
        await page.screenshot({
          path: `smoke-screens/event-${scheme}-${label}.png`,
          fullPage: true,
        });

        await page.goto("/upcoming/finance", { waitUntil: "networkidle" });
        await page.screenshot({
          path: `smoke-screens/theme-finance-${scheme}-${label}.png`,
          fullPage: true,
        });
        const row = page.locator("[data-event-actions]").first().locator("xpath=ancestor::li[1]");
        if (width >= 640) await row.hover();
        await page.waitForTimeout(300);
        await page.screenshot({
          path: `smoke-screens/row-actions-${scheme}-${label}.png`,
          fullPage: false,
          clip: await row.boundingBox().then((box) =>
            box
              ? { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: Math.min(width, box.width + 16), height: box.height + 16 }
              : undefined,
          ),
        });

        for (const list of YEAR_LISTS) {
          const response = await request.get(`/dates/${list.year}/${list.slug}`);
          if (response.status() !== 200) continue;
          await page.goto(`/dates/${list.year}/${list.slug}`, { waitUntil: "networkidle" });
          await page.screenshot({
            path: `smoke-screens/year-${list.slug}-${scheme}-${label}.png`,
            fullPage: true,
          });
        }
      });
    }
  }
});

test.describe("event pages are clean", () => {
  for (const scheme of ["dark", "light"] as const) {
    test(`no console errors and no serious axe violations, ${scheme}`, async ({
      page,
      request,
    }) => {
      await page.addInitScript((theme) => {
        localStorage.setItem("strikehike-theme", theme);
      }, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1440, height: 900 });
      const errors = watchErrors(page);
      const events = eventsOf(await readUpcoming(request));
      const indexable = events.find((event) => isIndexableEvent(event).index) ?? events[0];

      for (const path of [eventPath(indexable!.event_id), "/upcoming/finance", "/dates/2027/fomc-meetings"]) {
        const response = await page.goto(path, { waitUntil: "networkidle" });
        if (response?.status() !== 200) continue;
        const results = await new AxeBuilder({ page }).analyze();
        const serious = results.violations.filter(
          (violation) => violation.impact === "serious" || violation.impact === "critical",
        );
        expect(
          serious,
          `${path}: ${JSON.stringify(serious.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target) })))}`,
        ).toEqual([]);
      }
      expect(errors).toEqual([]);
    });
  }
});
