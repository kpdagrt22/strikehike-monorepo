import { expect, test, type Page } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mockHomeData } from "./fixtures/homeData";
import { ORRERY_OVERLAYS } from "./orreryOverlays";

// The production default is the phone poster, but the normal Playwright build
// runs without NEXT_PUBLIC_ORRERY_PHONE so it can test the live scene. This
// spec builds its own poster-mode copy into .next-poster and serves it on 3100,
// leaving the suite's live build untouched.

const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const DIST = ".next-poster";
let server: ReturnType<typeof spawn> | null = null;
const TSCONFIG = join(process.cwd(), "tsconfig.json");
let tsconfigBefore = "";

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(BASE, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`poster server did not answer on ${BASE}`);
}

function stopServer() {
  if (!server?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      shell: true,
      stdio: "ignore",
    });
  } else {
    server.kill("SIGTERM");
  }
  server = null;
}

test.describe("orrery poster mode", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    // Next rewrites tsconfig.json to include the new distDir types; keep the
    // repository copy unchanged across this test build.
    tsconfigBefore = readFileSync(TSCONFIG, "utf8");
    const env = {
      ...process.env,
      NEXT_DIST_DIR: DIST,
      NEXT_PUBLIC_ORRERY_PHONE: "poster",
      NEXT_PUBLIC_ANALYTICS_ENABLED: "0",
      NEXT_TELEMETRY_DISABLED: "1",
    };
    const build = spawnSync("npm", ["run", "build"], {
      shell: true,
      env,
      encoding: "utf8",
      timeout: 420_000,
    });
    if (build.status !== 0) {
      throw new Error(
        `poster build failed (${build.status}):\n${(build.stderr || build.stdout || "").slice(-2_000)}`,
      );
    }

    server = spawn("npm", ["run", "start", "--", "-p", String(PORT)], {
      shell: true,
      env,
      stdio: "ignore",
    });
    await waitForServer();
  });

  test.afterAll(() => {
    stopServer();
    if (tsconfigBefore) writeFileSync(TSCONFIG, tsconfigBefore);
  });

  async function open(page: Page) {
    await mockHomeData(page);
    await page.goto(`${BASE}/?orreryProbe=1`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-orrery-poster]")).toBeVisible();
  }

  for (const [width, height] of [
    [390, 844],
    [360, 740],
  ] as const) {
    test(`the poster holds the HUD clear at ${width}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width, height },
      });
      const page = await context.newPage();
      try {
        await open(page);
        const button = page.getByRole("button", { name: "Start the 3D view" });
        await expect(button).toBeVisible();
        expect(await page.locator("canvas").count()).toBe(0);

        const clear: string[] = [];
        for (const [name, selector] of ORRERY_OVERLAYS) {
          const locator = page.locator(selector).first();
          if (!(await locator.isVisible().catch(() => false))) continue;
          const box = await locator.boundingBox();
          expect(box, name).not.toBeNull();
          expect(box!.width, name).toBeGreaterThan(1);
          expect(box!.height, name).toBeGreaterThan(1);
          // The HUD stays inside the viewport and the poster's one button
          // never sits under a HUD block.
          const bleed = name === "aura" ? 24 : 1;
          expect(box!.x, name).toBeGreaterThanOrEqual(-bleed);
          expect(box!.y, name).toBeGreaterThanOrEqual(-bleed);
          expect(box!.x + box!.width, name).toBeLessThanOrEqual(width + bleed);
          expect(box!.y + box!.height, name).toBeLessThanOrEqual(height + bleed);
          clear.push(name);
        }
        expect(clear.length).toBeGreaterThan(3);
        // The one control on the poster must win the hit test at its centre.
        const buttonCovered = await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const top = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return !(top === element || element.contains(top));
        });
        expect(buttonCovered, "the poster button is covered").toBe(false);

        await button.click();
        await expect(page.locator("canvas")).toBeVisible();
        await expect(page.locator('[data-orrery-ready="true"]')).toBeVisible({
          timeout: 25_000,
        });
      } finally {
        await context.close();
      }
    });
  }

  test("desktop at 1440 still mounts the live scene without a tap", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    try {
      await mockHomeData(page);
      await page.goto(`${BASE}/?orreryProbe=1`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("[data-orrery-poster]")).toHaveCount(0);
      await expect(page.locator("canvas")).toBeVisible({ timeout: 25_000 });
      await expect(page.locator('[data-orrery-ready="true"]')).toBeVisible({
        timeout: 25_000,
      });
    } finally {
      await context.close();
    }
  });
});
