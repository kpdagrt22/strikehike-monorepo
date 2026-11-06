import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockHomeData } from "./fixtures/homeData";

const H1 = "The market record beside the sky, tested in public.";
const PRIMARY = "See 170 years of markets beside the sky";
const VIEWS = [
  { label: "Orrery", href: "/" },
  { label: "Regime", href: "/regime" },
  { label: "Convergence", href: "/convergence" },
  { label: "Patterns", href: "/patterns" },
  { label: "Upcoming", href: "/upcoming" },
];

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function home(page: Page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("[data-home-intro]")).toBeVisible();
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(left: Box, right: Box) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

const SURFACE_VIEWPORTS = [
  ["1024x768", 1024, 768],
  ["1280x720", 1280, 720],
  ["1440x900", 1440, 900],
  ["390x844", 390, 844],
] as const;

async function setupHome(
  page: Page,
  {
    width,
    height,
    theme = "dark",
    returning = false,
    archiveOpen = false,
  }: {
    width: number;
    height: number;
    theme?: "dark" | "light";
    returning?: boolean;
    archiveOpen?: boolean;
  },
) {
  await page.addInitScript(
    ({ theme: nextTheme, seen, open }) => {
      localStorage.setItem("strikehike-theme", nextTheme);
      localStorage.setItem("strikehike:home:archive-open", open ? "1" : "0");
      if (seen) localStorage.setItem("hasSeenIntro", "1");
      else localStorage.removeItem("hasSeenIntro");
    },
    { theme, seen: returning, open: archiveOpen },
  );
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize({ width, height });
  await mockHomeData(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("[data-home-intro]")).toBeVisible();
  await expect(page.locator('[data-hud="gauge"]')).toBeVisible();
  if (width >= 1024) {
    await expect(page.locator("#chrono-events-sheet")).toBeVisible();
    await expect(page.locator("#chrono-events-sheet")).toContainText(
      "159 moments",
    );
    await expect(page.locator("#chrono-archive-toggle")).toHaveAttribute(
      "aria-expanded",
      archiveOpen ? "true" : "false",
    );
  }
  if (returning && width < 640) {
    await expect(
      page.locator("[data-home-intro][data-compact='true']"),
    ).toBeVisible();
  }
}

async function readSurfaceBoxes(
  page: Page,
  width: number,
): Promise<Record<string, Box>> {
  const nav =
    width >= 640 ? '[data-shell="nav-pill"]' : '[data-shell="nav-row"]';
  const specs: Array<[string, string, boolean?]> = [
    ["intro", "[data-home-intro]"],
    ["nav", nav],
    ["gauge", '[data-hud="gauge"]', true],
    ["archive", "#chrono-events-sheet"],
    ["ladder", "#chrono-ladder-sheet"],
    ["footnote", "[data-ladder-footnote]"],
    ["right", "#chrono-alignment-sheet"],
    ["hint", "[data-home-hint]"],
    ["feedback", "[data-home-feedback]"],
    ["sponsor", "[data-home-sponsor]"],
    ["dock", '[data-hud="dock"]'],
    ["timeline", '[data-hud="timeline"]'],
  ];
  const boxes: Record<string, Box> = {};
  for (const [name, selector, includeAura] of specs) {
    const locator = page.locator(selector).first();
    if (!(await locator.isVisible().catch(() => false))) continue;
    const box = await locator.boundingBox();
    if (!box) continue;
    boxes[name] = { ...box };
    if (includeAura) {
      const aura = page.locator(".sh-aura").first();
      if (await aura.isVisible().catch(() => false)) {
        const auraBox = await aura.boundingBox();
        if (auraBox) {
          const left = Math.min(box.x, auraBox.x);
          const top = Math.min(box.y, auraBox.y);
          const right = Math.max(box.x + box.width, auraBox.x + auraBox.width);
          const bottom = Math.max(
            box.y + box.height,
            auraBox.y + auraBox.height,
          );
          boxes[name] = {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
          };
        }
      }
    }
  }
  return boxes;
}

function assertNoOverlaps(boxes: Record<string, Box>) {
  const names = Object.keys(boxes);
  for (let left = 0; left < names.length; left += 1) {
    for (let right = left + 1; right < names.length; right += 1) {
      const a = names[left];
      const b = names[right];
      // The footnote is the last child of the ladder panel by design.
      if (
        (a === "ladder" && b === "footnote") ||
        (a === "footnote" && b === "ladder")
      ) {
        continue;
      }
      expect(
        overlaps(boxes[a], boxes[b]),
        `${a} overlaps ${b}: ${JSON.stringify({ [a]: boxes[a], [b]: boxes[b] })}`,
      ).toBe(false);
    }
  }
}

async function assertFootnoteAndFeedback(page: Page) {
  const ladder = page.locator("#chrono-ladder-sheet");
  const feedback = page.locator("[data-home-feedback]");
  if (
    !(await ladder.isVisible().catch(() => false)) ||
    !(await feedback.isVisible().catch(() => false))
  ) {
    return;
  }
  const ladderBox = await ladder.boundingBox();
  const feedbackBox = await feedback.boundingBox();
  expect(ladderBox).not.toBeNull();
  expect(feedbackBox).not.toBeNull();
  expect(ladderBox!.y + ladderBox!.height).toBeLessThanOrEqual(
    feedbackBox!.y - 12,
  );

  const footnote = page.locator("[data-ladder-footnote]");
  if (!(await footnote.isVisible().catch(() => false))) return;
  const footnoteBox = await footnote.boundingBox();
  expect(footnoteBox).not.toBeNull();
  expect(footnoteBox!.y + footnoteBox!.height).toBeLessThanOrEqual(
    feedbackBox!.y - 12,
  );
  const hit = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return Boolean(element?.closest("[data-ladder-footnote]"));
    },
    {
      x: footnoteBox!.x + footnoteBox!.width / 2,
      y: footnoteBox!.y + footnoteBox!.height / 2,
    },
  );
  expect(hit).toBe(true);
}

async function assertAuraClearsNav(page: Page, width: number) {
  if (width < 1024) return;
  const nav = page.locator('[data-shell="nav-pill"]');
  const aura = page.locator(".sh-aura").first();
  await expect(nav).toBeVisible();
  await expect(aura).toBeVisible();
  const navBox = await nav.boundingBox();
  const auraBox = await aura.boundingBox();
  expect(navBox).not.toBeNull();
  expect(auraBox).not.toBeNull();
  expect(auraBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height + 8);
}

function rgbChannels(value: string): [number, number, number] {
  const parts = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function linearChannel(value: number) {
  const channel = value / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(value: string) {
  const [red, green, blue] = rgbChannels(value);
  return (
    0.2126 * linearChannel(red) +
    0.7152 * linearChannel(green) +
    0.0722 * linearChannel(blue)
  );
}

function contrastRatio(foreground: string, background: string) {
  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

async function assertPrimaryContrast(page: Page) {
  const primary = page.getByRole("link", { name: PRIMARY });
  const colors = () =>
    primary.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor };
    });
  const check = async (label: string) => {
    const value = await colors();
    expect(
      contrastRatio(value.color, value.background),
      `${label}: ${JSON.stringify(value)}`,
    ).toBeGreaterThanOrEqual(4.5);
  };

  await check("rest");
  await primary.hover();
  await page.waitForTimeout(250);
  await check("hover");
  await page.mouse.move(2, 2);
  await primary.focus();
  await page.waitForTimeout(250);
  expect(await primary.evaluate((element) => element.matches(":focus-visible")))
    .toBe(true);
  await check("focus");
}

test.describe("home first paint", () => {
  test("the no-JavaScript HTML carries the promise and first action", async ({
    request,
  }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(H1);
    expect(html).toContain('href="/regime"');
    expect(html).not.toContain("October 28, 2026");
    expect(html).not.toContain("2026-10-28");
  });

  test("exactly one h1", async ({ page }) => {
    await home(page);
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test("desktop headline and action are visible within 3 s", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      const started = Date.now();
      await page.goto("/", { waitUntil: "commit" });
      await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible(
        { timeout: 3_000 },
      );
      await expect(page.getByRole("link", { name: PRIMARY })).toBeVisible({
        timeout: Math.max(500, 3_000 - (Date.now() - started)),
      });
      expect(Date.now() - started).toBeLessThanOrEqual(3_000);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("phone headline and action are visible within 5 s at 4x CPU", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const started = Date.now();
      await page.goto("/", { waitUntil: "commit" });
      await expect(page.getByRole("heading", { level: 1, name: H1 })).toBeVisible(
        { timeout: 5_000 },
      );
      await expect(page.getByRole("link", { name: PRIMARY })).toBeVisible({
        timeout: Math.max(500, 5_000 - (Date.now() - started)),
      });
      expect(Date.now() - started).toBeLessThanOrEqual(5_000);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("home layout", () => {
  for (const [label, width, height] of [
    ["1440x900", 1440, 900],
    ["1280x720", 1280, 720],
    ["1024x768", 1024, 768],
    ["390x844", 390, 844],
  ] as const) {
    test(`headline clears the HUD at ${label}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height });
      await home(page);
      const intro = await page.locator("[data-home-intro]").boundingBox();
      expect(intro).not.toBeNull();
      console.log(`home intro ${label}`, intro);
      const targets = [
        page.locator('[data-hud="gauge"]'),
        page.locator("#chrono-alignment-sheet"),
        page.locator("#chrono-ladder-sheet"),
        page.locator('[data-hud="timeline"]'),
        page.locator('[data-hud="dock"]'),
      ];
      for (const target of targets) {
        if (!(await target.isVisible())) continue;
        const box = await target.boundingBox();
        if (!box) continue;
        expect(
          overlaps(intro!, box),
          `intro overlaps ${await target.evaluate((element) => element.id || element.getAttribute("data-hud"))}`,
        ).toBe(false);
      }
      expect(errors).toEqual([]);
    });
  }
});

test.describe("home overlap matrix", () => {
  for (const [label, width, height] of SURFACE_VIEWPORTS) {
    for (const returning of [false, true]) {
      test(`${label}, ${returning ? "returning" : "first visit"}`, async ({
        page,
      }) => {
        const errors = watchErrors(page);
        await setupHome(page, { width, height, returning });

        const closed = await readSurfaceBoxes(page, width);
        console.log(
          `home boxes ${label} ${returning ? "returning" : "first"} closed`,
          JSON.stringify(closed),
        );
        assertNoOverlaps(closed);
        await assertFootnoteAndFeedback(page);

        if (width >= 1024) {
          await assertAuraClearsNav(page, width);
          const toggle = page.locator("#chrono-archive-toggle");
          await toggle.click();
          await expect(toggle).toHaveAttribute("aria-expanded", "true");
          await page.waitForTimeout(150);
          const open = await readSurfaceBoxes(page, width);
          console.log(
            `home boxes ${label} ${returning ? "returning" : "first"} open`,
            JSON.stringify(open),
          );
          assertNoOverlaps(open);
          await assertFootnoteAndFeedback(page);
        }

        if (width < 640 && returning) {
          const intro = page.locator("[data-home-intro]");
          const h1 = intro.locator("h1");
          await expect(intro).toHaveAttribute("data-compact", "true");
          await expect(h1).toHaveText(H1);
          await expect(page.locator("[data-home-promise]")).toHaveCount(0);
          await expect(page.locator("[data-home-secondary]")).toHaveCount(0);
          await expect(page.getByRole("link", { name: PRIMARY })).toBeVisible();
          const fontSize = await h1.evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize),
          );
          expect(fontSize).toBeCloseTo(20, 0);
          const h1Box = await h1.boundingBox();
          expect(h1Box).not.toBeNull();
          expect(h1Box!.height).toBeLessThanOrEqual(48);
          const gauge = closed.gauge;
          expect(gauge).toBeDefined();
          // The camera looks at the Sun at [0, 0, 0], so the Sun projects
          // to the centre of the viewport.
          expect(gauge!.y + gauge!.height).toBeLessThanOrEqual(
            height / 2 - 24,
          );
        }

        if (width < 640 && !returning) {
          await expect(page.locator("[data-home-hint]")).toBeVisible();
          await expect(page.locator("[data-home-promise]")).toHaveCount(1);
          await expect(page.locator("[data-home-secondary]")).toHaveCount(1);
        }

        expect(errors).toEqual([]);
      });
    }
  }
});

test("the desktop archive is closed by default and remembers its state", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("strikehike-theme", "dark");
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockHomeData(page);
  await page.goto("/", { waitUntil: "networkidle" });

  const toggle = page.locator("#chrono-archive-toggle");
  const body = page.locator("#chrono-archive-body");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();

  await page.reload({ waitUntil: "networkidle" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(body).toBeHidden();
});

test.describe("home axe", () => {
  for (const scheme of ["dark", "light"] as const) {
    test(`/ has no serious or critical violations, ${scheme}`, async ({
      page,
    }) => {
      await setupHome(page, {
        width: 1440,
        height: 900,
        theme: scheme,
      });
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      );
      expect(
        serious,
        JSON.stringify(
          serious.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            targets: violation.nodes.map((node) => node.target),
          })),
        ),
      ).toEqual([]);
    });
  }
});

test.describe("home primary contrast", () => {
  for (const scheme of ["dark", "light"] as const) {
    test(`primary action meets 4.5:1 at rest, hover and focus, ${scheme}`, async ({
      page,
    }) => {
      await setupHome(page, {
        width: 1440,
        height: 900,
        theme: scheme,
      });
      await assertPrimaryContrast(page);
    });
  }
});

test.describe("navigation is one action", () => {
  for (const [label, width, height] of [
    ["desktop", 1440, 900],
    ["phone", 390, 844],
  ] as const) {
    test(`every view on ${label}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.setViewportSize({ width, height });
      for (const view of VIEWS) {
        await page.goto("/", { waitUntil: "networkidle" });
        const link = page.getByRole("link", {
          name: view.label,
          exact: true,
        }).first();
        await expect(link).toBeVisible();
        await link.click();
        await expect
          .poll(() => new URL(page.url()).pathname)
          .toBe(view.href);
        await expect(
          page.getByRole("link", { name: view.label, exact: true }).first(),
        ).toHaveAttribute("aria-current", "page");
      }
      expect(errors).toEqual([]);
    });
  }
});

test("the hint dismisses with Escape and stays dismissed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  const hint = page.locator("[data-home-hint]");
  await expect(hint).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(hint).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await expect(page.locator("[data-home-hint]")).toHaveCount(0);
});

test("Disclaimer is reachable from the menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  const menu = page.locator("#site-nav-menu");
  await page.getByRole("button", { name: "StrikeHike menu" }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "Disclaimer", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe("/disclaimer");
  await page.getByRole("button", { name: "StrikeHike menu" }).click();
  await expect(
    menu.getByRole("link", { name: "Disclaimer", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("Finance is fully visible in the home Upcoming chips", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  await page.locator("#chrono-dock-archive").click();
  await page.locator("#chrono-archive-to-ladder").click();
  await expect(page.locator("#upcoming-finance")).toBeVisible();
  const row = page.locator(
    '[role="group"][aria-label="Filter upcoming events by theme"]',
  );
  const chip = page.locator('button[data-theme="Finance"]');
  await chip.scrollIntoViewIfNeeded();
  const rowBox = await row.boundingBox();
  const chipBox = await chip.boundingBox();
  expect(rowBox).not.toBeNull();
  expect(chipBox).not.toBeNull();
  expect(chipBox!.x).toBeGreaterThanOrEqual(rowBox!.x);
  expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(
    rowBox!.x + rowBox!.width,
  );
  expect(errors).toEqual([]);
});

test.describe("home review screenshots", () => {
  for (const scheme of ["dark", "light"] as const) {
    for (const [label, width, height] of [
      ["desktop", 1440, 900],
      ["phone", 390, 844],
    ] as const) {
      test(`first visit with hint, ${scheme} ${label}`, async ({ page }) => {
        await page.addInitScript((theme) => {
          localStorage.setItem("strikehike-theme", theme);
          localStorage.setItem("strikehike:home:archive-open", "0");
        }, scheme);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await home(page);
        await expect(page.locator("[data-home-hint]")).toBeVisible();
        await page.screenshot({
          path: `smoke-screens/home-first-${scheme}-${label}.png`,
        });
      });

      test(`returning visit without hint, ${scheme} ${label}`, async ({ page }) => {
        await page.addInitScript((theme) => {
          localStorage.setItem("strikehike-theme", theme);
          localStorage.setItem("hasSeenIntro", "1");
          localStorage.setItem("strikehike:home:archive-open", "0");
        }, scheme);
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await home(page);
        await expect(page.locator("[data-home-hint]")).toHaveCount(0);
        if (width < 640) {
          await expect(
            page.locator("[data-home-intro][data-compact='true']"),
          ).toBeVisible();
        }
        await page.screenshot({
          path: `smoke-screens/home-return-${scheme}-${label}.png`,
        });
      });
    }
  }
});

test("archive open, light desktop", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("strikehike-theme", "light");
    localStorage.setItem("hasSeenIntro", "1");
    localStorage.setItem("strikehike:home:archive-open", "1");
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await home(page);
  await expect(page.locator("#chrono-archive-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.locator("#chrono-archive-body")).toBeVisible();
  await page.screenshot({
    path: "smoke-screens/home-archive-open-light-desktop.png",
  });
});

test.describe("navigation review screenshots", () => {
  for (const scheme of ["dark", "light"] as const) {
    test(`header nav desktop, ${scheme}`, async ({ page }) => {
      await page.addInitScript((theme) => {
        localStorage.setItem("strikehike-theme", theme);
        localStorage.setItem("hasSeenIntro", "1");
      }, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1440, height: 900 });
      await home(page);
      await page.screenshot({
        path: `smoke-screens/header-nav-1440-${scheme}.png`,
        clip: { x: 0, y: 0, width: 1440, height: 90 },
      });
    });

    test(`header nav phone and scrolled row, ${scheme}`, async ({ page }) => {
      await page.addInitScript((theme) => {
        localStorage.setItem("strikehike-theme", theme);
        localStorage.setItem("hasSeenIntro", "1");
      }, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await home(page);
      await page.screenshot({
        path: `smoke-screens/header-nav-390-${scheme}.png`,
        clip: { x: 0, y: 0, width: 390, height: 124 },
      });
      await page.goto("/upcoming", { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `smoke-screens/header-nav-390-upcoming-${scheme}.png`,
        clip: { x: 0, y: 0, width: 390, height: 124 },
      });
    });

    test(`phone dock, ${scheme}`, async ({ page }) => {
      await page.addInitScript((theme) => {
        localStorage.setItem("strikehike-theme", theme);
        localStorage.setItem("hasSeenIntro", "1");
      }, scheme);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await home(page);
      await page.locator('[data-hud="dock"]').screenshot({
        path: `smoke-screens/dock-phone-${scheme}.png`,
      });
    });
  }
});
