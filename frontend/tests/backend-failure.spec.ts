import { expect, test, type APIRequestContext } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { YEAR_LISTS } from "../src/lib/events/yearLists";

// A slow or failing backend must never turn a real page into a 404 (ROBUST-recessions).
// This spec serves the suite's own production build (.next/standalone) a second time,
// against a stub backend it controls, so the main server and its backend are untouched:
// - a missing id is a 404 while the backend answers;
// - a cold page whose backend fails or times out is a 503 with Retry-After;
// - once a page has loaded, a failing backend still serves it (200);
// - after a restart (empty memo) with the backend down, an ISR page Next still
//   holds on disk answers with that copy (200).

const STANDALONE_DIR = join(process.cwd(), ".next", "standalone");
const STANDALONE = join(STANDALONE_DIR, "server.js");
// Next's on-disk ISR copies: server/route-cache/APP_PAGE/<sha256(page)>/$<path>.html.
function isrDir(page: string) {
  const owner = createHash("sha256").update(page).digest("hex");
  return join(STANDALONE_DIR, ".next", "server", "route-cache", "APP_PAGE", owner);
}
const EVENT_ISR = isrDir("/(engine)/events/[id]/page");
const DATES_ISR = isrDir("/(engine)/dates/[year]/[list]/page");
const RECESSION = "nber-1929-08";
const FALL = { name: "1929 crash", peak: "1929-09-16", low: "1932-06-01" };
const DECLINE = `${FALL.peak}-1929-crash`;
const EVENT_ID = "finance:stub_source:probe-2026-12";
const EVENT_PATH = `/events/${EVENT_ID.replaceAll(":", "~")}`;
const MISSING_EVENT_PATH = "/events/finance~stub_source~missing-2026-12";
const YEAR_LIST = YEAR_LISTS.find((list) => list.year === "2027" && list.slug === "fomc-meetings")!;
const YEAR_PATH = `/dates/${YEAR_LIST.year}/${YEAR_LIST.slug}`;

// down: no backend at all (the connection closes unanswered); busy: every call
// answers 503 with the backend's own Retry-After.
type Mode = "ok" | "fail" | "hang" | "down" | "busy";
const BUSY_RETRY_AFTER = "120";
let mode: Mode = "ok";
const hits = { atlas: 0 };
let stub: Server | null = null;
let site: ChildProcess | null = null;
let base = "";

function atlasFixture() {
  const timeline = [];
  for (let day = Date.UTC(1928, 11, 28); day <= Date.UTC(1934, 11, 28); day += 7 * 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10);
    const t = (day - Date.UTC(1928, 11, 28)) / (7 * 86_400_000);
    const fall = date >= "1929-09-16" && date <= "1932-06-01";
    timeline.push({
      date,
      core_index: fall ? -30 + (t % 5) : 10 - (t % 5),
      core_index_bucket: fall ? "bearish_warning" : "calm_bullish",
      sp500_proxy: fall ? 30 - t * 0.12 : 25 + t * 0.05,
    });
  }
  return {
    as_of: "2026-11-13",
    coverage: { start: "1928-12-28", end: "2026-11-13" },
    crashes: [
      {
        id: RECESSION,
        name: "Great Depression",
        type: "nber_recession",
        start: "1929-08-01",
        end: "1933-03-31",
        start_month: "1929-08",
        end_month: "1933-03",
        date_precision: "month",
      },
    ],
    meta: {
      core_index_first_scored: "1928-12-28",
      core_index_trend_warning: {
        record: {
          falls_of_20pct_or_more: {
            count: 1,
            falls: [{ ...FALL, size: 0.86, first_warning: "1929-10-04", within_first_20pct: true }],
          },
        },
      },
    },
    timeline,
  };
}

function eventFixture(id: string) {
  const listed = YEAR_LIST.entries.find((entry) => entry.id === id);
  const date = listed?.date ?? "2026-12-09";
  return {
    event_id: id,
    name: listed ? `FOMC decision ${date}` : "Stub probe release",
    theme: "Finance",
    kind: "upcoming",
    start_date: date,
    start_time: null,
    timezone: null,
    start_utc: null,
    all_day: true,
    status: "scheduled",
    verification: "official",
    source_url: "https://example.org/source",
    authority_url: null,
    source_id: "stub_source",
    description: "A dated release used by the backend-failure test.",
    days_until: 30,
  };
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function handle(request: IncomingMessage, response: ServerResponse) {
  if (mode === "down") {
    request.socket.destroy();
    return;
  }
  if (mode === "busy") {
    response.writeHead(503, { "Content-Type": "application/json", "Retry-After": BUSY_RETRY_AFTER });
    response.end(JSON.stringify({ detail: "stub busy" }));
    return;
  }
  const url = new URL(request.url ?? "/", "http://stub");
  const isAtlas = url.pathname === "/api/v1/regime/macro-history" && url.searchParams.get("view") === "atlas";
  const eventMatch = url.pathname.match(/^\/api\/v1\/events\/([^/]+)$/);
  const isEvent = eventMatch && !["upcoming", "health"].includes(eventMatch[1]);
  if (isAtlas) hits.atlas += 1;
  if (isAtlas || isEvent) {
    if (mode === "hang") return; // never answers: the frontend's 8 s timeout fires
    if (mode === "fail") return send(response, 500, { detail: "stub failure" });
  }
  if (isAtlas) return send(response, 200, atlasFixture());
  if (isEvent) {
    const id = decodeURIComponent(eventMatch![1]);
    if (id.includes("missing")) return send(response, 404, { detail: "Event not found" });
    return send(response, 200, eventFixture(id));
  }
  if (url.pathname === "/api/v1/events/upcoming") {
    return send(response, 200, { as_of: "2026-11-16", bundle_version: "stub", themes: {} });
  }
  if (url.pathname === "/api/v1/events/health") {
    return send(response, 200, { active_version: "stub", counts: { total: 0, by_theme_kind_status: {} } });
  }
  return send(response, 404, { detail: "Not in the stub" });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

async function waitForSite() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${base}/version.json`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the stubbed site did not answer on ${base}`);
}

let stubPort = 0;

async function startSite() {
  const sitePort = await freePort();
  base = `http://127.0.0.1:${sitePort}`;
  site = spawn(process.execPath, [STANDALONE], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(sitePort),
      HOSTNAME: "127.0.0.1",
      CHRONO_API_URL: `http://127.0.0.1:${stubPort}`,
    },
    stdio: "ignore",
  });
  await waitForSite();
}

async function stopSite() {
  const child = site;
  site = null;
  if (!child?.pid) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 10_000))]);
}

async function expectUnavailable(request: APIRequestContext, path: string) {
  const response = await request.get(`${base}${path}`, { maxRedirects: 0, timeout: 30_000 });
  expect(response.status(), `${path} status`).toBe(503);
  expect(response.headers()["retry-after"], `${path} Retry-After`).toBe("60");
  expect(response.headers()["cache-control"], `${path} Cache-Control`).toBe("no-store");
  const body = await response.text();
  expect(body).not.toContain("Off the timeline");
  return body;
}

test.describe("backend failure never reads as a missing page", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!existsSync(STANDALONE), "needs a production build (.next/standalone)");

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    // These routes render on demand only (no build-time copies): clear the
    // stub pages a previous run left on disk, so the cold-page tests are cold.
    rmSync(EVENT_ISR, { recursive: true, force: true });
    rmSync(DATES_ISR, { recursive: true, force: true });
    stubPort = await freePort();
    stub = createServer(handle);
    await new Promise<void>((resolve) => stub!.listen(stubPort, "127.0.0.1", resolve));
    await startSite();
  });

  test.afterAll(async () => {
    await stopSite();
    // Drop the hanging stub connections, then the stub.
    stub?.closeAllConnections();
    await new Promise((resolve) => stub?.close(resolve) ?? resolve(null));
    stub = null;
  });

  test("cold pages with a failing backend answer 503 with Retry-After", async ({ request, page }) => {
    mode = "fail";
    for (const path of [
      `/recessions/${RECESSION}`,
      `/declines/${DECLINE}`,
      EVENT_PATH,
      YEAR_PATH,
    ]) {
      const body = await expectUnavailable(request, path);
      expect(body, path).toContain("This page could not load its data.");
      expect(body, path).toContain(`href="${path}"`);
    }
    for (const path of [`/recessions/${RECESSION}/card.png`, `/declines/${DECLINE}/card.png`]) {
      await expectUnavailable(request, path);
    }

    // What a reader sees: the state, its retry link, and no 404 copy.
    const response = await page.goto(`${base}/recessions/${RECESSION}`);
    expect(response?.status()).toBe(503);
    await expect(page.getByRole("heading", { name: "This page could not load its data." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toHaveAttribute("href", `/recessions/${RECESSION}`);
  });

  test("a cold page whose backend times out answers 503, not 404", async ({ request }) => {
    test.setTimeout(90_000);
    mode = "hang";
    await expectUnavailable(request, `/recessions/${RECESSION}`);
    await expectUnavailable(request, EVENT_PATH);
  });

  test("a missing id is a 404 while the backend answers", async ({ request }) => {
    mode = "ok";
    // The first load: the proxy reads the atlas, the page renders from that copy.
    const atlasBefore = hits.atlas;
    const first = await request.get(`${base}/recessions/nber-1800-01`, { maxRedirects: 0 });
    expect(first.status()).toBe(404);
    expect(hits.atlas - atlasBefore, "atlas requests for one page view").toBe(1);
    for (const path of [
      "/recessions/nber-1800-01",
      "/declines/1800-01-01-no-such-fall",
      MISSING_EVENT_PATH,
      "/recessions/nber-1800-01/card.png",
    ]) {
      const response = await request.get(`${base}${path}`, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
    }
  });

  test("real pages load from the stored atlas", async ({ request }) => {
    mode = "ok";
    const atlasBefore = hits.atlas;
    for (const path of [`/recessions/${RECESSION}`, `/declines/${DECLINE}`, EVENT_PATH, YEAR_PATH]) {
      const response = await request.get(`${base}${path}`, { maxRedirects: 0 });
      expect(response.status(), path).toBe(200);
    }
    // The atlas was stored by the 404 test above; nothing asked the backend again.
    expect(hits.atlas - atlasBefore).toBe(0);
    const html = await (await request.get(`${base}/recessions/${RECESSION}`)).text();
    expect(html).toContain("Great Depression");
  });

  test("once loaded, a failing or hanging backend still serves the page (200)", async ({ request }) => {
    for (const next of ["fail", "hang"] as const) {
      mode = next;
      for (const path of [
        `/recessions/${RECESSION}`,
        `/declines/${DECLINE}`,
        EVENT_PATH,
        YEAR_PATH,
        `/recessions/${RECESSION}/card.png`,
      ]) {
        const response = await request.get(`${base}${path}`, { maxRedirects: 0, timeout: 20_000 });
        expect(response.status(), `${next} ${path}`).toBe(200);
      }
      // A stored atlas still answers a missing id with a real 404.
      const missing = await request.get(`${base}/recessions/nber-1800-01`, { maxRedirects: 0 });
      expect(missing.status(), `${next} missing id`).toBe(404);
    }
  });

  // OPS-hardening: every 503 the proxy routes answer names Retry-After and is
  // never cached. None of these routes was read earlier in this server, so no
  // stored copy can answer for them.
  const EVENT_SLUG = EVENT_ID.replaceAll(":", "~");
  const API_GETS = [
    "/api/v1/events/upcoming",
    "/api/v1/events/health",
    `/api/v1/events/${EVENT_SLUG}`,
    "/api/v1/regime/macro-history?resolution=weekly",
    "/api/v1/regime/cases",
    "/api/v1/regime/cases/today/path",
    "/api/v1/regime/crypto-milestones",
    "/api/v1/regime/forecast",
    "/api/v1/regime/runs",
    "/api/v1/patterns",
    "/api/v1/sky/week?start=2026-11-16",
    "/api/events",
    "/api/forecast-ladder",
    "/api/digest/status",
    "/api/v1/usage/weekly?week=2026-W46",
    "/calendar/all.ics",
    `/calendar/event/${EVENT_SLUG}.ics`,
    "/this-week/2026-W46/calendar.ics",
  ];
  const API_POSTS: Array<[string, string]> = [
    ["/api/digest/subscribe", JSON.stringify({ email: "reader@example.org" })],
    ["/api/digest/unsubscribe?t=stub", "List-Unsubscribe=One-Click"],
    ["/api/v1/feedback", JSON.stringify({ message: "stub", path: "/" })],
  ];

  async function expectRetryAfter(
    response: Awaited<ReturnType<APIRequestContext["get"]>>,
    label: string,
    retryAfter: string,
  ) {
    expect(response.status(), `${label} status`).toBe(503);
    expect(response.headers()["retry-after"], `${label} Retry-After`).toBe(retryAfter);
    expect(response.headers()["cache-control"], `${label} Cache-Control`).toBe("no-store");
  }

  function post(request: APIRequestContext, path: string, data: string) {
    return request.post(`${base}${path}`, {
      data,
      headers: { Origin: base, "Content-Type": "text/plain" },
      maxRedirects: 0,
      timeout: 30_000,
    });
  }

  test("with the backend down, every proxy 503 names Retry-After: 60 and no-store", async ({ request }) => {
    mode = "down";
    for (const path of API_GETS) {
      await expectRetryAfter(await request.get(`${base}${path}`, { maxRedirects: 0, timeout: 30_000 }), path, "60");
    }
    for (const [path, data] of API_POSTS) {
      await expectRetryAfter(await post(request, path, data), `POST ${path}`, "60");
    }
  });

  test("a backend 503 keeps its own Retry-After where the route passes it through", async ({ request }) => {
    mode = "busy";
    for (const path of [
      "/api/digest/status",
      "/api/v1/usage/weekly?week=2026-W46",
      "/api/v1/regime/forecast",
      "/api/v1/regime/runs",
    ]) {
      await expectRetryAfter(await request.get(`${base}${path}`, { maxRedirects: 0 }), path, BUSY_RETRY_AFTER);
    }
    for (const [path, data] of API_POSTS) {
      await expectRetryAfter(await post(request, path, data), `POST ${path}`, BUSY_RETRY_AFTER);
    }
    // The cached proxy routes answer their own 503 body: the default applies.
    for (const path of ["/api/v1/patterns", "/api/v1/events/upcoming", "/calendar/all.ics"]) {
      await expectRetryAfter(await request.get(`${base}${path}`, { maxRedirects: 0 }), path, "60");
    }
  });

  test("after a restart with the backend down, a page Next holds on disk still answers 200", async ({ request }) => {
    test.setTimeout(120_000);
    // The event, the year list and the missing id rendered above, so Next has
    // written them to its on-disk ISR cache.
    const copies = [
      join(EVENT_ISR, "$", "events", `${EVENT_SLUG}.html`),
      join(EVENT_ISR, "$", "events", `${MISSING_EVENT_PATH.split("/")[2]}.html`),
      join(DATES_ISR, "$", "dates", YEAR_LIST.year, `${YEAR_LIST.slug}.html`),
    ];
    await expect.poll(() => copies.filter((file) => !existsSync(file)), { timeout: 15_000 }).toEqual([]);

    // A restart empties the memo; the backend is gone.
    mode = "down";
    await stopSite();
    await startSite();

    for (const path of [EVENT_PATH, YEAR_PATH]) {
      const response = await request.get(`${base}${path}`, { maxRedirects: 0, timeout: 30_000 });
      expect(response.status(), path).toBe(200);
      expect(await response.text(), path).not.toContain("This page could not load its data.");
    }
    const event = await request.get(`${base}${EVENT_PATH}`, { maxRedirects: 0 });
    expect(await event.text()).toContain("Stub probe release");
    // A stored "no such event" is still a 404.
    expect((await request.get(`${base}${MISSING_EVENT_PATH}`, { maxRedirects: 0 })).status()).toBe(404);

    // A hanging backend: the gate's read times out (8 s), then Next answers from disk.
    mode = "hang";
    const hung = await request.get(`${base}${EVENT_PATH}`, { maxRedirects: 0, timeout: 30_000 });
    expect(hung.status()).toBe(200);

    // No copy on disk or in the memo: still a 503 with Retry-After, never a 404.
    mode = "down";
    await expectUnavailable(request, "/events/finance~stub_source~never-rendered-2026-12");
    // Recession and decline pages are dynamic (no ISR copy): after a restart
    // with the backend down they answer 503 until the backend returns.
    await expectUnavailable(request, `/recessions/${RECESSION}`);
  });
});
