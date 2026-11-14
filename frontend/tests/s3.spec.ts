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
