import { chromium, expect, test } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// On-demand only: the normal suite serves a report-only build. Point
// CSP_ENFORCE_URL at a CSP_MODE=enforce build; set CSP_ENFORCE_ALL=1 to crawl
// every URL from the launch-crawl JSON.
const BASE = process.env.CSP_ENFORCE_URL ?? "";

test.describe("@csp-enforce", () => {
  test.skip(!BASE, "set CSP_ENFORCE_URL to an enforce-mode build");

  test("enforce mode raises no securitypolicyviolation", async () => {
    test.setTimeout(600_000);
    const routes = process.env.CSP_ENFORCE_ALL === "1"
      ? JSON.parse(
          await import("node:fs/promises").then((fs) =>
            fs.readFile(
              resolve(process.cwd(), "../../_plan/kp-2026-11/reports/launch-crawl.json"),
              "utf8",
            ),
          ),
        ).pages_data.map((page: { url: string }) => new URL(page.url).pathname)
      : [
          "/",
          "/disclaimer",
          "/about",
          "/regime",
          "/upcoming",
          "/convergence",
          "/tested/full-moon",
          "/this-week",
        ];

    const context = await chromium.launchPersistentContext(
      await mkdtemp(join(tmpdir(), "csp-enforce-")),
      {
        channel: "chromium",
        headless: true,
        viewport: { width: 390, height: 844 },
      },
    );
    await context.addInitScript(() => {
      (window as unknown as { __cspViolations: unknown[] }).__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        (window as unknown as { __cspViolations: unknown[] }).__cspViolations.push({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
        });
      });
    });
    const page = await context.newPage();
    const all: Array<{ route: string; violations: unknown[]; enforced: boolean }> = [];
    try {
      for (const route of routes) {
        const response = await page.goto(`${BASE}${route}`, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        await page.waitForTimeout(1_200);
        const violations = await page.evaluate(
          () => (window as unknown as { __cspViolations: unknown[] }).__cspViolations ?? [],
        );
        const enforced = Boolean(response?.headers()["content-security-policy"]);
        all.push({ route, violations, enforced });
        if (!enforced || violations.length > 0) {
          console.log(`CSP ${route}: enforced=${enforced} violations=${JSON.stringify(violations)}`);
        }
      }
    } finally {
      await context.close();
    }

    const bad = all.filter((row) => !row.enforced || row.violations.length > 0);
    expect(bad, JSON.stringify(bad.slice(0, 5))).toEqual([]);
  });
});
