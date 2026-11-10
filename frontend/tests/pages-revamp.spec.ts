import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Part A: the Upcoming family uses the whole screen. The shell is centred, the
// list starts inside the first viewport, and every row is at most 72 px.

type Event = { event_id: string; start_date: string; status: string };
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

async function readUpcoming(request: APIRequestContext) {
  const response = await request.get(
    "/api/v1/events/upcoming?limit_per_theme=100&horizon_days=730",
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as Upcoming;
}

function listedEvents(payload: Upcoming) {
  return Object.values(payload.themes).flatMap((theme) => theme.events ?? []);
}

async function familyPaths(request: APIRequestContext) {
  const events = listedEvents(await readUpcoming(request));
  const event = events.find((item) => item.status === "scheduled") ?? events[0];
  expect(event).toBeDefined();
  return [
    "/upcoming",
    "/upcoming/finance",
    eventPath(event!.event_id),
    "/dates/2027/fomc-meetings",
  ];
}

const SIZES = [
  [1366, 768],
  [1920, 1080],
  [2560, 1440],
] as const;

test.describe("upcoming family layout", () => {
  for (const [width, height] of SIZES) {
    test(`centred with compact rows at ${width}x${height}`, { tag: "@deploy" }, async ({
      page,
      request,
    }) => {
      const errors = watchErrors(page);
      const paths = await familyPaths(request);
      await page.setViewportSize({ width, height });

      for (const path of paths) {
        const response = await page.goto(path, { waitUntil: "networkidle" });
        expect(response?.status(), path).toBe(200);

        const shell = await page.locator("[data-page-shell]").boundingBox();
        expect(shell, `${path}: shell`).not.toBeNull();
        const leftGap = shell!.x;
        const rightGap = width - (shell!.x + shell!.width);
        expect(
          Math.abs(leftGap - rightGap),
          `${path}: gaps ${leftGap}/${rightGap}`,
        ).toBeLessThanOrEqual(32);

        const rows = page.locator("[data-upcoming-row]");
        const count = await rows.count();
        expect(count, `${path}: rows`).toBeGreaterThan(0);
        const first = await rows.first().boundingBox();
        expect(first!.y, `${path}: first row in view`).toBeLessThan(height);
        for (let index = 0; index < Math.min(count, 5); index += 1) {
          const box = await rows.nth(index).boundingBox();
          expect(box!.height, `${path}: row ${index}`).toBeLessThanOrEqual(72);
        }
      }

      expect(errors).toEqual([]);
    });
  }
});

const SHOTS = [
  [1920, 1080],
  [1366, 768],
  [390, 844],
  [360, 740],
] as const;

test.describe("upcoming family screenshots", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const [width, height] of SHOTS) {
      test(`${scheme} ${width}x${height}`, async ({ page, request }) => {
        const errors = watchErrors(page);
        const paths = await familyPaths(request);
        const event = paths[2];
        const named = [
          ["upcoming", paths[0]],
          ["upcoming-finance", paths[1]],
          ["event", event],
          ["dates", paths[3]],
        ] as const;

        await page.addInitScript((theme) => {
          localStorage.setItem("strikehike-theme", theme);
        }, scheme);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });

        for (const [name, path] of named) {
          const response = await page.goto(path, { waitUntil: "networkidle" });
          expect(response?.status(), path).toBe(200);
          await expect(page.locator("[data-page-shell]")).toBeVisible();
          await page.screenshot({
            path: `smoke-screens/${name}-${width}-${scheme}.png`,
          });
        }
        expect(errors).toEqual([]);
      });
    }
  }
});
