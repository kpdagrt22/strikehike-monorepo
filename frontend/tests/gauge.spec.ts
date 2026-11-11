import { mkdirSync } from "node:fs";
import {
  expect,
  test,
  type Browser,
  type Page,
} from "@playwright/test";
import { mockHomeData } from "./fixtures/homeData";

// The Sky activity gauge: a legible score on an opaque face, and the solar
// corona from 85. The score is forced through the /api/chrono/** mock
// (energy.score).

const TIERS = [
  { tier: 1, score: 87 },
  { tier: 2, score: 92 },
  { tier: 3, score: 99 },
] as const;
const FIT_SCORES = [0, 9, 85, 99, 100];
const SIZES = [
  { label: "1440", width: 1440, height: 900 },
  { label: "390", width: 390, height: 844 },
] as const;
const MAX_AURA_ELEMENTS = 8;

type Box = { x: number; y: number; width: number; height: number };

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function openGauge(
  page: Page,
  {
    score,
    width,
    height,
    theme = "dark",
    reducedMotion = "no-preference",
  }: {
    score: number;
    width: number;
    height: number;
    theme?: "dark" | "light";
    reducedMotion?: "reduce" | "no-preference";
  },
) {
  // A returning visitor: no hint, and on a phone the compact gauge.
  await page.addInitScript((nextTheme) => {
    localStorage.setItem("strikehike-theme", nextTheme);
    localStorage.setItem("hasSeenIntro", "1");
    localStorage.setItem("strikehike:home:archive-open", "0");
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion });
  await page.setViewportSize({ width, height });
  await mockHomeData(page, { score });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("[data-gauge-number]")).toHaveText(
    String(Math.round(score)),
  );
  if (width < 640) {
    await expect(
      page.locator("[data-home-intro][data-compact='true']"),
    ).toBeVisible();
  }
}

async function auraState(page: Page) {
  return page.evaluate(() => {
    const aura = document.querySelector<HTMLElement>(".sh-aura");
    const animations = document.getAnimations().filter((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return target instanceof Element && Boolean(target.closest(".sh-aura"));
    });
    const loops = animations.filter(
      (animation) => (animation as CSSAnimation).animationName !== "sh-aura-in",
    );
    return {
      tier: aura?.dataset.tier ?? null,
      mode: aura?.dataset.mode ?? null,
      elements: aura ? aura.querySelectorAll("*").length + 1 : 0,
      loops: loops.length,
      running: loops.filter((animation) => animation.playState === "running").length,
      paused: loops.filter((animation) => animation.playState === "paused").length,
    };
  });
}

async function faceAndScore(page: Page) {
  return page.evaluate(() => {
    const read = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return { face: read("[data-gauge-face]"), score: read("[data-gauge-score]") };
  });
}

function circleOf(face: Box) {
  return { cx: face.x + face.width / 2, cy: face.y + face.height / 2, r: face.width / 2 };
}

function channels(value: string) {
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

function over(top: string, bottom: string) {
  const front = channels(top);
  const back = channels(bottom);
  const mix = (a: number, b: number) => a * front.a + b * (1 - front.a);
  return `rgb(${mix(front.r, back.r)}, ${mix(front.g, back.g)}, ${mix(front.b, back.b)})`;
}

function luminance(value: string) {
  const { r, g, b } = channels(value);
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(foreground: string, background: string) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function hideTab(page: Page, hidden: boolean) {
  await page.evaluate((nextHidden) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (nextHidden ? "hidden" : "visible"),
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => nextHidden,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test.describe("gauge fire", () => {
  for (const { tier, score } of TIERS) {
    test(`tier ${tier} (${score}): within budget, running, paused when hidden`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await openGauge(page, { score, width: 1440, height: 900 });
      await expect(page.locator(".sh-aura")).toHaveAttribute("data-tier", String(tier));

      const running = await auraState(page);
      console.log(`aura tier ${tier} 1440`, JSON.stringify(running));
      expect(running.elements).toBeLessThanOrEqual(MAX_AURA_ELEMENTS);
      expect(running.loops).toBeGreaterThan(0);
      expect(running.running).toBe(running.loops);

      await hideTab(page, true);
      await expect.poll(async () => (await auraState(page)).running).toBe(0);
      expect((await auraState(page)).paused).toBe(running.loops);
      await hideTab(page, false);
      await expect.poll(async () => (await auraState(page)).running).toBe(running.loops);
      expect(errors).toEqual([]);
    });

    test(`tier ${tier} (${score}): the compact phone gauge pauses under a sheet`, async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await openGauge(page, { score, width: 390, height: 844 });
      const before = await auraState(page);
      console.log(`aura tier ${tier} 390`, JSON.stringify(before));
      expect(before.mode).toBe("compact");
      expect(before.elements).toBeLessThanOrEqual(MAX_AURA_ELEMENTS);
      expect(before.running).toBe(before.loops);

      await page.locator("#chrono-dock-archive").click();
      await expect(page.locator(".sh-aura")).toHaveAttribute("data-paused", "true");
      await expect.poll(async () => (await auraState(page)).running).toBe(0);
      await page.keyboard.press("Escape");
      await expect.poll(async () => (await auraState(page)).running).toBe(before.loops);
      expect(errors).toEqual([]);
    });

    test(`tier ${tier} (${score}): reduced motion is one still frame`, async ({ page }) => {
      const errors = watchErrors(page);
      await openGauge(page, { score, width: 1440, height: 900, reducedMotion: "reduce" });
      await expect(page.locator(".sh-aura")).toHaveAttribute("data-tier", String(tier));
      const state = await auraState(page);
      expect(state.running).toBe(0);
      expect(state.loops).toBe(0);
      expect(errors).toEqual([]);
    });

    for (const size of SIZES) {
      test(`tier ${tier} (${score}): the opaque face sits above the corona at ${size.label}`, async ({
        page,
      }) => {
        const errors = watchErrors(page);
        await openGauge(page, { score, width: size.width, height: size.height });
        const order = await page.evaluate(() => {
          const face = document.querySelector("[data-gauge-face]")!;
          const aura = document.querySelector(".sh-aura")!;
          const layers = [aura, ...aura.querySelectorAll("*")];
          return {
            faceAlpha: getComputedStyle(face).backgroundColor,
            // Every corona layer comes before the face in the same stacking
            // context, and none lifts itself with a z-index.
            allBefore: layers.every(
              (layer) =>
                Boolean(layer.compareDocumentPosition(face) & Node.DOCUMENT_POSITION_FOLLOWING),
            ),
            zIndexes: layers.map((layer) => getComputedStyle(layer).zIndex),
          };
        });
        expect(channels(order.faceAlpha).a).toBe(1);
        expect(order.allBefore).toBe(true);
        expect(order.zIndexes.every((value) => value === "auto")).toBe(true);
        expect(errors).toEqual([]);
      });
    }
  }
});

test.describe("gauge score", () => {
  for (const size of SIZES) {
    for (const score of FIT_SCORES) {
      test(`${score} sits inside the face at ${size.label}`, async ({ page }) => {
        const errors = watchErrors(page);
        await openGauge(page, { score, width: size.width, height: size.height });
        const { face, score: group } = await faceAndScore(page);
        const circle = circleOf(face);
        const corners = [
          [group.x, group.y],
          [group.x + group.width, group.y],
          [group.x, group.y + group.height],
          [group.x + group.width, group.y + group.height],
        ];
        const farthest = Math.max(
          ...corners.map(([x, y]) => Math.hypot(x - circle.cx, y - circle.cy)),
        );
        console.log(
          `score ${score} at ${size.label}: face r ${circle.r}, group ${group.width.toFixed(1)}x${group.height.toFixed(1)}, padding ${(circle.r - farthest).toFixed(1)} px`,
        );
        expect(circle.r - farthest).toBeGreaterThanOrEqual(6);
        const numerals = await page
          .locator("[data-gauge-number]")
          .evaluateAll((elements) =>
            elements.map((element) => getComputedStyle(element).fontVariantNumeric),
          );
        expect(numerals.every((value) => value.includes("tabular-nums"))).toBe(true);
        expect(errors).toEqual([]);
      });
    }
  }

  for (const theme of ["dark", "light"] as const) {
    test(`the number contrasts with the face, ${theme}`, async ({ page }) => {
      await openGauge(page, { score: 99, width: 1440, height: 900, theme });
      const colors = await page.evaluate(() => ({
        face: getComputedStyle(document.querySelector("[data-gauge-face]")!).backgroundColor,
        number: getComputedStyle(document.querySelector("[data-gauge-number]")!).color,
        of: document.querySelectorAll("[data-gauge-of]").length,
      }));
      expect(channels(colors.face).a).toBe(1); // opaque
      expect(colors.of).toBe(0); // the number stands alone
      const number = contrast(over(colors.number, colors.face), colors.face);
      console.log(`contrast ${theme}: number ${number.toFixed(2)}:1`, JSON.stringify(colors));
      expect(number).toBeGreaterThanOrEqual(7);
    });
  }
});

// Review evidence for CI's smoke-screens artifact.
async function gaugeClip(page: Page, width: number) {
  const ring = await page.locator("[data-gauge-face]").boundingBox();
  const half = width >= 640 ? 170 : 105;
  const cx = ring!.x + ring!.width / 2;
  const cy = ring!.y + ring!.height / 2;
  const x = Math.max(0, cx - half);
  const y = Math.max(0, cy - half);
  return { x, y, width: half * 2, height: half * 2 };
}

test.describe("gauge review evidence", () => {
  for (const theme of ["dark", "light"] as const) {
    for (const size of SIZES) {
      for (const { tier, score } of TIERS) {
        test(`frames, tier ${tier}, ${theme} ${size.label}`, async ({ page }) => {
          await openGauge(page, { score, width: size.width, height: size.height, theme });
          await page.waitForTimeout(600);
          const clip = await gaugeClip(page, size.width);
          for (let frame = 1; frame <= 4; frame += 1) {
            await page.screenshot({
              path: `smoke-screens/gauge-${tier}-${theme}-${size.label}-${frame}.png`,
              clip,
            });
            await page.waitForTimeout(150);
          }
        });
      }
    }
  }

  for (const { tier, score } of TIERS) {
    test(`reduced-motion still, tier ${tier}`, async ({ page }) => {
      await openGauge(page, {
        score,
        width: 1440,
        height: 900,
        reducedMotion: "reduce",
      });
      await page.screenshot({
        path: `smoke-screens/gauge-${tier}-still-dark-1440.png`,
        clip: await gaugeClip(page, 1440),
      });
    });

    test(`3-second video, tier ${tier}, dark 1440`, async ({ browser }) => {
      mkdirSync("smoke-screens", { recursive: true });
      const context = await (browser as Browser).newContext({
        viewport: { width: 1440, height: 900 },
        recordVideo: { dir: "test-results/gauge-video", size: { width: 1440, height: 900 } },
      });
      const page = await context.newPage();
      try {
        await openGauge(page, { score, width: 1440, height: 900 });
        await page.waitForTimeout(3_000);
      } finally {
        await context.close();
      }
      await page.video()!.saveAs(`smoke-screens/gauge-${tier}-dark-1440.webm`);
    });
  }
});
