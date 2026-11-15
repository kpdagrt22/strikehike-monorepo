import { expect, test } from "@playwright/test";

type Node = Record<string, unknown>;

async function nodes(page: import("@playwright/test").Page): Promise<Node[]> {
  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  return blocks.flatMap((text) => {
    const parsed = JSON.parse(text) as Node;
    const graph = parsed["@graph"];
    return Array.isArray(graph) ? (graph as Node[]) : [parsed];
  });
}

test.describe("S3: server data, thin pages and distributions", () => {
  test("home server HTML carries the latest week, Core Index and next dates", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const snapshot = page.locator("[data-home-snapshot]");
    await expect(snapshot).toHaveCount(1);
    await expect(snapshot).toContainText("At a glance");
    await expect(snapshot).toContainText("Core Index");
    await expect(
      snapshot.locator("[data-home-snapshot-next] li"),
    ).toHaveCount(3);
  });

  test("the week Dataset lists its JSON and calendar downloads", async ({
    page,
  }) => {
    await page.goto("/this-week/2026-W47", { waitUntil: "domcontentloaded" });
    const dataset = (await nodes(page)).find((node) =>
      String(node["@id"]).endsWith("#sky-dataset"),
    );
    expect(dataset).toBeTruthy();
    const urls = (
      dataset!["distribution"] as Node[]
    ).map((item) => String(item["contentUrl"]));
    expect(urls).toContain(
      "https://strikehike.com/this-week/2026-W47/roundup.json",
    );
    expect(urls).toContain(
      "https://strikehike.com/this-week/2026-W47/data.json",
    );
    expect(urls).toContain(
      "https://strikehike.com/this-week/2026-W47/calendar.ics",
    );
  });

  test("the upcoming Dataset lists the calendar feeds", async ({ page }) => {
    await page.goto("/upcoming", { waitUntil: "domcontentloaded" });
    const dataset = (await nodes(page)).find((node) =>
      String(node["@id"]).endsWith("#calendar-dataset"),
    );
    expect(dataset).toBeTruthy();
    const urls = (
      dataset!["distribution"] as Node[]
    ).map((item) => String(item["contentUrl"]));
    expect(urls).toContain("https://strikehike.com/calendar/all.ics");
    expect(urls).toContain("https://strikehike.com/calendar/finance.ics");
  });

  test("event pages carry a factual paragraph with its source", async ({
    page,
  }) => {
    await page.goto("/upcoming", { waitUntil: "domcontentloaded" });
    const eventLink = page.locator('a[href^="/events/"]').first();
    await expect(eventLink).toBeVisible();
    const href = await eventLink.getAttribute("href");
    await page.goto(href!, { waitUntil: "domcontentloaded" });
    const factual = page.locator("[data-event-factual]");
    await expect(factual).toBeVisible();
    await expect(factual).toContainText(/Source:|Method:/);
    await expect(factual.locator("a")).toHaveAttribute("href", /^https:\/\//);
  });

  test("recession pages carry NBER months, duration and the USREC source", async ({
    page,
  }) => {
    await page.goto("/recessions/nber-1854-11", {
      waitUntil: "domcontentloaded",
    });
    const facts = page.locator("[data-recession-facts]");
    await expect(facts).toBeVisible();
    await expect(facts).toContainText("NBER peak");
    await expect(facts).toContainText("days");
    await expect(facts.locator("a")).toHaveAttribute(
      "href",
      "https://fred.stlouisfed.org/series/USREC",
    );
  });

  test("the home page is ISR and its server HTML uses the public bucket words", async ({
    request,
  }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("data-home-snapshot");
    // The raw Core Index keys never reach the public page.
    expect(html.toLowerCase()).not.toContain("bullish");
    expect(html.toLowerCase()).not.toContain("bearish");
    // ISR, not a per-request render.
    const cache = response.headers()["cache-control"] ?? "";
    expect(cache).toContain("s-maxage=");
    expect(cache).not.toContain("no-store");
  });

  test("the window list is cacheable and unknown claims are 404", async ({
    request,
  }) => {
    const known = await request.get("/tested/full-moon/windows.json");
    expect(known.status()).toBe(200);
    expect(known.headers()["cache-control"]).toBe(
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    const unknown = await request.get("/tested/not-a-claim/windows.json");
    expect(unknown.status()).toBe(404);
  });

  test("/upcoming defaults to a rolling window, not the first calendar month", async ({
    page,
    request,
  }) => {
    const payload = (await (
      await request.get("/api/v1/events/upcoming?limit_per_theme=100&horizon_days=365")
    ).json()) as {
      themes: Record<string, { events: unknown[] }>;
    };
    const total = Object.entries(payload.themes)
      .filter(([name]) => name !== "Politics" && name !== "Natural Disasters")
      .reduce((sum, [, theme]) => sum + theme.events.length, 0);

    await page.goto("/upcoming", { waitUntil: "domcontentloaded" });
    const rows = await page.locator("[data-upcoming-row]").count();
    // The next 30 days, or the first ten dates when the window is thin: never
    // one or two dates because the calendar month is about to turn.
    expect(rows).toBeGreaterThanOrEqual(Math.min(10, total));
    expect(rows).toBeLessThanOrEqual(total);
    if (total > rows) {
      await expect(
        page.getByRole("link", { name: /Show all \d+ dates/ }),
      ).toBeVisible();
    }
  });

  test("approved week pages are cacheable and answer a conditional GET", async ({
    request,
  }) => {
    const first = await request.get("/this-week/2026-W47");
    expect(first.status()).toBe(200);
    const etag = first.headers()["etag"];
    expect(etag).toBeTruthy();
    const second = await request.get("/this-week/2026-W47", {
      headers: { "If-None-Match": etag },
    });
    expect(second.status()).toBe(304);
  });

  test("the tested window list is fetched only when opened", async ({
    page,
    request,
  }) => {
    const json = await request.get("/tested/full-moon/windows.json");
    expect(json.status()).toBe(200);
    const payload = (await json.json()) as { windows?: unknown[] };
    expect(payload.windows?.length).toBeGreaterThan(100);

    await page.goto("/tested/full-moon", { waitUntil: "domcontentloaded" });
    const table = page.locator("[data-claim-windows]");
    await expect(table).toHaveCount(1);
    await expect(table).toBeHidden();
    await page.locator("details", { has: table }).locator("summary").click();
    await expect(table).toBeVisible();
  });
});
