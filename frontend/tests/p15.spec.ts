import { expect, test, type Page } from "@playwright/test";

const STATUS = "**/api/digest/status";
const SUBSCRIBE = "**/api/digest/subscribe";

async function enableDigest(page: Page) {
  await page.route(STATUS, (route) =>
    route.fulfill({ status: 200, json: { enabled: true } }),
  );
}

async function disableDigest(page: Page) {
  await page.route(STATUS, (route) => route.fulfill({ status: 404, body: "" }));
}

test.describe("P15: the weekly email form", () => {
  test.use({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  test(
    "the form and footer line are absent when the backend reports off",
    { tag: "@deploy" },
    async ({ page }) => {
      await disableDigest(page);
      const status = page.waitForResponse(STATUS);
      await page.goto("/this-week", { waitUntil: "networkidle" });
      await status;
      await expect(page.locator("[data-digest-signup]")).toHaveCount(0);
      await expect(page.locator("[data-digest-footer-link]")).toHaveCount(0);
    },
  );

  test("the footer line opens the form with the footer surface", async ({ page }) => {
    await enableDigest(page);
    const status = page.waitForResponse(STATUS);
    await page.goto("/about", { waitUntil: "networkidle" });
    await status;
    const link = page.locator("[data-digest-footer-link]");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute(
      "href",
      "/this-week?digest=footer#weekly-email",
    );
    await link.click();
    await expect(page.locator('[data-digest-signup="footer"]')).toBeVisible();
  });

  test("a successful submit shows the pending message and sends no PII", async ({
    page,
  }) => {
    await enableDigest(page);
    await page.route(SUBSCRIBE, (route) =>
      route.fulfill({ status: 202, json: { status: "check_inbox" } }),
    );
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      const sink: Promise<string>[] = [];
      (window as unknown as { __digestBeacons: Promise<string>[] }).__digestBeacons =
        sink;
      navigator.sendBeacon = (url, data) => {
        if (String(url).includes("/api/v1/usage") && data instanceof Blob) {
          sink.push(data.text());
        }
        return true;
      };
    });

    const status = page.waitForResponse(STATUS);
    await page.goto("/this-week", { waitUntil: "networkidle" });
    await status;
    const form = page.locator('[data-digest-signup="this_week"]');
    await expect(form).toBeVisible();
    await form.locator('input[name="email"]').fill("reader@example.com");
    await form.locator('input[type="checkbox"]').check();
    await form.getByRole("button", { name: "Subscribe" }).click();
    await expect(form.locator("[data-digest-message]")).toContainText(
      "Check your inbox to confirm.",
    );

    await page.waitForTimeout(5_500);
    const bodies = await page.evaluate(() =>
      Promise.all(
        (window as unknown as { __digestBeacons: Promise<string>[] })
          .__digestBeacons,
      ),
    );
    const text = bodies.join("\n");
    expect(text).toContain('"n":"digest_subscribed"');
    expect(text).toContain('"surface":"this_week"');
    expect(text).not.toContain("reader@example.com");
  });

  test("rate-limited and failed submits keep their own states", async ({ page }) => {
    await enableDigest(page);
    let mode: "ok" | "rate" | "error" = "rate";
    await page.route(SUBSCRIBE, (route) => {
      if (mode === "rate") {
        return route.fulfill({ status: 429, json: { detail: "rate_limited" } });
      }
      if (mode === "error") {
        return route.fulfill({ status: 500, json: { detail: "failed" } });
      }
      return route.fulfill({ status: 202, json: { status: "check_inbox" } });
    });

    const status = page.waitForResponse(STATUS);
    await page.goto("/this-week", { waitUntil: "networkidle" });
    await status;
    const form = page.locator('[data-digest-signup="this_week"]');
    const email = form.locator('input[name="email"]');
    const consent = form.locator('input[type="checkbox"]');
    const button = form.getByRole("button", { name: "Subscribe" });

    await email.fill("reader@example.com");
    await consent.check();
    await button.click();
    await expect(form.locator("[data-digest-message]")).toContainText(
      "Too many requests from here.",
    );

    mode = "error";
    await email.fill("reader@example.com");
    await consent.check();
    await button.click();
    await expect(form.locator("[data-digest-message]")).toContainText(
      "Couldn't subscribe.",
    );

    mode = "ok";
    await email.fill("reader@example.com");
    await consent.check();
    await button.click();
    await expect(form.locator("[data-digest-message]")).toContainText(
      "Check your inbox to confirm.",
    );
  });
});

test.describe("P15: the approved-roundup JSON route", () => {
  test("serves an approved week and 404s an unknown one", async ({ request }) => {
    const approved = await request.get("/this-week/2026-W46/data.json");
    expect(approved.status()).toBe(200);
    const payload = await approved.json();
    expect(payload.week).toBe("2026-W46");
    expect(payload.approved).toBe(true);

    const missing = await request.get("/this-week/1900-W01/data.json");
    expect(missing.status()).toBe(404);
  });
});

test.describe("P15: digest result pages", () => {
  test(
    "confirmed, unsubscribed and invalid render quietly and stay out of the index",
    { tag: "@deploy" },
    async ({ page }) => {
      await disableDigest(page);
      const pages = [
        ["/digest/confirmed", "You're on the list."],
        ["/digest/unsubscribed", "You've been unsubscribed."],
        ["/digest/invalid", "This link is invalid or has expired."],
      ] as const;
      for (const [path, heading] of pages) {
        const response = await page.goto(path, { waitUntil: "networkidle" });
        expect(response?.status(), path).toBe(200);
        await expect(page.locator("h1")).toContainText(heading);
        const robots = await page
          .locator('meta[name="robots"]')
          .getAttribute("content");
        expect(robots, path).toContain("noindex");
      }
    },
  );

  test("the one-click unsubscribe page posts and lands on the unsubscribed page", async ({
    page,
  }) => {
    await disableDigest(page);
    await page.route("**/api/digest/unsubscribe**", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 200,
          json: { status: "unsubscribed" },
        });
      }
      return route.continue();
    });
    await page.goto("/digest/unsubscribe?t=test-token", {
      waitUntil: "networkidle",
    });
    await page.getByRole("button", { name: "Unsubscribe me" }).click();
    await page.waitForURL("**/digest/unsubscribed");
    await expect(page.locator("h1")).toContainText("You've been unsubscribed.");
  });
});
