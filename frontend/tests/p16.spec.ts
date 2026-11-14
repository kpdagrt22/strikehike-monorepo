import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const GENESIS_SHORT = "088f0d925c2d";
const GENESIS_ROUNDUP_SHA =
  "b17185b3854046174df42d5420235f9d4de3c5b506e033470cda2efe4724ba44";

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function seedTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    localStorage.setItem("strikehike-theme", value);
  }, theme);
  await page.emulateMedia({ colorScheme: theme });
}

test.describe("P16: the published ledger", () => {
  test(
    "renders the genesis line and serves the raw JSONL",
    { tag: "@deploy" },
    async ({ page, request }) => {
      const errors = watchErrors(page);
      await page.goto("/ledger", { waitUntil: "networkidle" });
      await expect(page.locator("h1")).toHaveText("Ledger");
      await expect(page.locator("table")).toContainText("2026-W46");
      await expect(page.locator("table")).toContainText("Steady");
      await expect(page.locator("table")).toContainText(GENESIS_SHORT);
      const fullHash = page.locator('details[id^="hash-"] code').first();
      await expect(fullHash).toBeHidden();
      await page.locator('details[id^="hash-"] summary').first().click();
      await expect(fullHash).toBeVisible();
      await expect(page.getByText("starts at 2026-W46", { exact: false })).toBeVisible();
      await expect(page.locator("[data-ledger-verify]")).toBeVisible();

      const raw = await request.get("/ledger.jsonl");
      expect(raw.status()).toBe(200);
      expect(raw.headers()["content-type"]).toContain("text/plain");
      const body = await raw.text();
      expect(body).toContain('"week":"2026-W46"');
      expect(body.trim().split(/\r?\n/)).toHaveLength(1);

      const roundup = await request.get("/this-week/2026-W46/roundup.json");
      expect(roundup.status()).toBe(200);
      const roundupBody = await roundup.text();
      expect(createHash("sha256").update(roundupBody).digest("hex")).toBe(
        GENESIS_ROUNDUP_SHA,
      );
      expect(
        (await request.get("/this-week/1900-W01/roundup.json")).status(),
      ).toBe(404);
      expect(errors).toEqual([]);
    },
  );

  test("week routes reject traversal and malformed weeks with 404", async ({
    request,
  }) => {
    const paths = [
      "/this-week/..%2F2026-W46/roundup.json",
      "/this-week/%2E%2E%2F2026-W46/roundup.json",
      "/this-week/2026-W46%2F..%2F2026-W46/roundup.json",
      "/this-week/..%2F2026-W46/data.json",
      "/this-week/%2E%2E%2F2026-W46/data.json",
      "/this-week/2026-W46%2F..%2F2026-W46/data.json",
      "/this-week/not-a-week/roundup.json",
      "/this-week/not-a-week/data.json",
    ];
    for (const path of paths) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });

  test("the browser verifier says the real chain is intact", async ({ page }) => {
    await page.goto("/ledger", { waitUntil: "networkidle" });
    await page.locator("[data-ledger-verify]").click();
    await expect(page.locator("[data-ledger-verify-result]")).toContainText(
      "✓ chain intact",
    );
  });

  test("the browser verifier reports a break at the tampered seq", async ({
    page,
  }) => {
    const tampered = await readFile(
      join(process.cwd(), "tests", "fixtures", "ledger-tampered.jsonl"),
      "utf8",
    );
    await page.route("**/ledger.jsonl", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: tampered,
      }),
    );
    await page.goto("/ledger", { waitUntil: "networkidle" });
    await page.locator("[data-ledger-verify]").click();
    await expect(page.locator("[data-ledger-verify-result]")).toContainText(
      "✗ break at seq 1",
    );
  });

  test(
    "the week page links to its ledger line",
    { tag: "@deploy" },
    async ({ page }) => {
      await page.goto("/this-week/2026-W46", { waitUntil: "networkidle" });
      const line = page.locator("[data-ledger-line]");
      await expect(line).toBeVisible();
      await expect(line).toContainText(`Ledger #1 · ${GENESIS_SHORT}`);
      await expect(line.locator("a")).toHaveAttribute("href", "/ledger#1");
    },
  );

  test("phone width does not scroll horizontally", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto("/ledger", { waitUntil: "networkidle" });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await context.close();
  });

  test("has no serious axe violations in either theme", async ({ browser }) => {
    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      await seedTheme(page, theme);
      await page.goto("/ledger", { waitUntil: "networkidle" });
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
      expect(serious, theme).toEqual([]);
      await context.close();
    }
  });

  test("review screenshots: light, dark and phone", async ({ browser }) => {
    for (const [theme, width, height] of [
      ["light", 1440, 900],
      ["dark", 1440, 900],
      ["light", 390, 844],
    ] as const) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await seedTheme(page, theme);
      await page.goto("/ledger", { waitUntil: "networkidle" });
      await page.screenshot({
        path: `smoke-screens/ledger-${theme}-${width}.png`,
        fullPage: true,
      });
      await context.close();
    }
  });
});
