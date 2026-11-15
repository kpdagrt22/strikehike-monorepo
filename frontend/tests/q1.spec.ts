import { expect, test } from "@playwright/test";

// Q1.1: the review items that need a browser or a redirect.
test.describe("Q1.1: redirects, late rows and the action tracker", () => {
  test("a rotated-out roundup event is a 308; an unknown id is a 404", async ({
    request,
  }) => {
    // W47's approved roundup lists this FRED release; the local bundle does not.
    const rotated = await request.get(
      "/events/finance~fred_release_dates~53-2026-11",
      { maxRedirects: 0 },
    );
    expect(rotated.status()).toBe(308);
    expect(rotated.headers()["location"]).toContain("/upcoming/finance");

    const unknown = await request.get("/events/finance~not-a-real-event~x", {
      maxRedirects: 0,
    });
    expect(unknown.status()).toBe(404);
  });

  test.describe("local time", () => {
    test.use({ timezoneId: "Asia/Kolkata" });

    test("rows that mount after a client navigation still show local time", async ({
      page,
    }) => {
      await page.goto("/upcoming", { waitUntil: "domcontentloaded" });
      const firstTime = page.locator('[data-ld="time"]').first();
      await expect(firstTime).toContainText("IST");

      // A client-side navigation to a theme page mounts a new row list.
      await page.locator('[data-upcoming-row] a[href^="/upcoming/"]').first().click();
      await page.waitForURL("**/upcoming/**");
      const themeTime = page.locator('[data-ld="time"]').first();
      await expect(themeTime).toContainText("IST");
    });
  });

  test("the delegated tracker sends date_travelled for See the sky", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
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

    await page.goto("/upcoming", { waitUntil: "domcontentloaded" });
    await page.locator('[data-event-action="sky"]').first().click();
    // The batch flushes every five seconds; the document stays (client nav).
    await page.waitForTimeout(6000);
    const bodies = await page.evaluate(() =>
      Promise.all(
        (window as unknown as { __beacons: Promise<string>[] }).__beacons,
      ),
    );
    const events = bodies.flatMap(
      (body) => JSON.parse(body).ev as Array<{ n: string; pr?: Record<string, unknown> }>,
    );
    const travelled = events.find((event) => event.n === "date_travelled");
    expect(travelled).toBeTruthy();
    expect(travelled!.pr?.method).toBe("archive_event");
    expect(travelled!.pr?.target_year).toBe(2026);
  });
});
