import { expect, test, type Page } from "@playwright/test";

// S2: the server HTML carries one JSON-LD graph per page type, the hub and
// archive link every approved week, and the ledger and week pages have their
// own share cards. These tests read the HTML the crawler sees, not the client
// state.

type Node = Record<string, unknown>;

async function graphNodes(page: Page): Promise<Node[]> {
  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  return blocks.flatMap((text) => {
    const parsed = JSON.parse(text) as Node;
    const graph = parsed["@graph"];
    return Array.isArray(graph) ? (graph as Node[]) : [parsed];
  });
}

function typed(nodes: Node[], type: string) {
  return nodes.filter((node) => {
    const value = node["@type"];
    return Array.isArray(value) ? value.includes(type) : value === type;
  });
}

test.describe("S2: JSON-LD and crawlable links", () => {
  test("home carries its WebPage graph and three research links", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const nodes = await graphNodes(page);
    const pageNode = typed(nodes, "WebPage").find((node) =>
      String(node["@id"]).endsWith("/#webpage"),
    );
    expect(pageNode).toBeTruthy();
    expect(pageNode!["mainEntity"]).toEqual({
      "@id": "https://strikehike.com/#app",
    });

    const panel = page.locator("#strikehike-info-panel");
    await expect(panel).toHaveCount(1);
    for (const href of ["/tested", "/recessions", "/declines"]) {
      expect(
        await panel.locator(`a[href="${href}"]`).count(),
        href,
      ).toBeGreaterThan(0);
    }
    await expect(page.locator("[data-home-colophon]")).toHaveCount(1);
  });

  test("/this-week is a CollectionPage with a complete archive", async ({
    page,
  }) => {
    await page.goto("/this-week", { waitUntil: "domcontentloaded" });
    const nodes = await graphNodes(page);
    const collection = typed(nodes, "CollectionPage")[0];
    expect(collection).toBeTruthy();
    expect(String(collection["@id"])).toContain("/this-week#webpage");

    const list = typed(nodes, "ItemList")[0];
    expect(list).toBeTruthy();
    const items = list["itemListElement"] as Node[];
    expect(list["numberOfItems"]).toBe(items.length);
    expect(items.length).toBeGreaterThanOrEqual(2);

    const archive = page.locator("[data-roundup-archive]");
    await expect(archive.locator('a[href="/this-week/2026-W46"]')).toBeVisible();
    await expect(archive.locator('a[href="/this-week/2026-W47"]')).toBeVisible();
    await expect(page.locator("[data-latest-roundup] a").first()).toHaveAttribute(
      "href",
      "/this-week/2026-W47",
    );
  });

  test("a week page has its H1, Article graph, sky Dataset and share card", async ({
    page,
    request,
  }) => {
    await page.goto("/this-week/2026-W47", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toContainText(/^Week of /);

    const nodes = await graphNodes(page);
    const article = typed(nodes, "Article")[0];
    expect(article).toBeTruthy();
    expect(String(article["headline"])).toMatch(/^Week of /);
    expect(String(article["datePublished"])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(article["image"])).toContain("/this-week/2026-W47/card.png");

    const card = await request.get(
      new URL(String(article["image"])).pathname,
    );
    expect(card.status()).toBe(200);
    expect(card.headers()["content-type"]).toContain("image/png");

    const sky = typed(nodes, "Dataset").find((node) =>
      String(node["@id"]).endsWith("#sky-dataset"),
    );
    expect(sky).toBeTruthy();
    expect(String(sky!["name"])).toContain("2026-W47");

    await expect(
      page.locator('link[rel="alternate"][type="application/json"]'),
    ).toHaveAttribute(
      "href",
      /\/this-week\/2026-W47\/roundup\.json$/,
    );

    const og = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(og).toBeTruthy();
    const image = await request.get(new URL(og!).pathname);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
  });

  test("the ledger has a Dataset graph, week links and its own share card", async ({
    page,
    request,
  }) => {
    await page.goto("/ledger", { waitUntil: "domcontentloaded" });
    const nodes = await graphNodes(page);
    const dataset = typed(nodes, "Dataset").find((node) =>
      String(node["@id"]).endsWith("/ledger#dataset"),
    );
    expect(dataset).toBeTruthy();
    expect(dataset!["license"]).toBe(
      "https://creativecommons.org/licenses/by/4.0/",
    );
    expect(
      String((dataset!["distribution"] as Node)["contentUrl"]),
    ).toContain("/ledger.jsonl");

    await expect(page.locator('a[href="/this-week/2026-W46"]')).toBeVisible();
    await expect(page.locator('a[href="/this-week/2026-W47"]')).toBeVisible();

    const og = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(og).toBeTruthy();
    const image = await request.get(new URL(og!).pathname);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toContain("image/png");
  });

  test("upcoming lists its themes and an event page carries an Event node", async ({
    page,
  }) => {
    await page.goto("/upcoming", { waitUntil: "domcontentloaded" });
    const upcomingNodes = await graphNodes(page);
    const list = typed(upcomingNodes, "ItemList")[0];
    expect(list).toBeTruthy();
    expect((list["itemListElement"] as Node[]).length).toBeGreaterThan(0);

    const eventLink = page.locator('a[href^="/events/"]').first();
    await expect(eventLink).toBeVisible();
    const href = await eventLink.getAttribute("href");
    expect(href).toBeTruthy();

    await page.goto(href!, { waitUntil: "domcontentloaded" });
    const eventNodes = await graphNodes(page);
    const event = typed(eventNodes, "Event")[0];
    expect(event).toBeTruthy();
    expect(event!["eventAttendanceMode"]).toBe(
      "https://schema.org/OnlineEventAttendanceMode",
    );
    expect(event!["startDate"]).toBeTruthy();
  });

  test("a tested claim shows its result and cite lines", async ({ page }) => {
    await page.goto("/tested/full-moon", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-claim-result-line]")).toContainText(
      /^Result: /,
    );
    await expect(page.locator("[data-claim-result-line]")).toContainText(
      /data to \d{4}-\d{2}-\d{2}/,
    );
    await expect(page.locator("[data-claim-cite]")).toContainText(/^Cite as: /);
    await expect(page.locator("[data-claim-cite]")).toContainText(
      "strikehike.com/tested/full-moon",
    );
  });

  test("about exposes its FAQ and terms both visibly and in JSON-LD", async ({
    page,
  }) => {
    await page.goto("/about", { waitUntil: "domcontentloaded" });
    const nodes = await graphNodes(page);
    const faq = typed(nodes, "FAQPage")[0];
    expect(faq).toBeTruthy();
    expect((faq["mainEntity"] as Node[]).length).toBeGreaterThan(0);
    const terms = typed(nodes, "DefinedTermSet")[0];
    expect(terms).toBeTruthy();
    expect((terms["hasDefinedTerm"] as Node[]).length).toBeGreaterThan(0);

    await expect(page.locator("#faq")).toBeVisible();
    await expect(page.locator("#faq dl").first().locator("dt")).toHaveCount(
      (faq["mainEntity"] as Node[]).length,
    );
  });
});

test.describe("S2: review screenshots", () => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    for (const scheme of ["light", "dark"] as const) {
      test(`this-week hub and ledger, ${width} ${scheme}`, async ({ browser }) => {
        const context = await browser.newContext({
          viewport: { width, height },
          colorScheme: scheme,
        });
        const page = await context.newPage();
        await page.addInitScript((value) => {
          localStorage.setItem("strikehike-theme", value);
        }, scheme);
        await page.goto("/this-week", { waitUntil: "networkidle" });
        await page.screenshot({
          path: `smoke-screens/s2-this-week-${width}-${scheme}.png`,
          fullPage: true,
        });
        await page.goto("/ledger", { waitUntil: "networkidle" });
        await page.screenshot({
          path: `smoke-screens/s2-ledger-${width}-${scheme}.png`,
          fullPage: true,
        });
        await context.close();
      });
    }
  }
});
