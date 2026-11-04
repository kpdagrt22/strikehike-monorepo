import assert from "node:assert/strict";
import test from "node:test";

process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "1";

function install({
  webdriver = false,
  ua = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  gpc = false,
  dnt = "0",
  storageWorks = true,
  search = "",
  referrer = "",
} = {}) {
  const data = new Map();
  const sent = [];
  const storage = {
    getItem(key) {
      if (!storageWorks) throw new Error("blocked");
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (!storageWorks) throw new Error("blocked");
      data.set(key, String(value));
    },
    removeItem(key) {
      if (!storageWorks) throw new Error("blocked");
      data.delete(key);
    },
  };
  const location = {
    href: `https://strikehike.com${search ? `/${search}` : "/"}`,
    search,
    host: "strikehike.com",
  };
  const history = {
    replaceState(_state, _title, value) {
      const url = new URL(value, "https://strikehike.com");
      location.search = url.search;
      location.href = url.href;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      webdriver,
      userAgent: ua,
      globalPrivacyControl: gpc,
      doNotTrack: dnt,
      sendBeacon(url, blob) {
        sent.push({ url, blob });
        return true;
      },
    },
  });
  globalThis.window = {
    localStorage: storage,
    location,
    history,
    innerWidth: 390,
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  };
  globalThis.document = {
    visibilityState: "visible",
    referrer,
    prerendering: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return { data, sent, storage };
}

async function body(sent) {
  assert.equal(sent.length, 1);
  return JSON.parse(await sent[0].blob.text());
}

test("an opted-out visitor sends nothing", async () => {
  const { data, sent } = install();
  data.set("strikehike:analytics:optout", "1");
  const track = await import("./track.ts?optout");
  track.trackPageView("/", "load");
  track.flushAnalytics();
  assert.equal(sent.length, 0);
});

test("Global Privacy Control and Do Not Track both stop sends", async () => {
  for (const [gpc, dnt] of [
    [true, "0"],
    [false, "1"],
  ]) {
    const { sent } = install({ gpc, dnt });
    const track = await import(`./track.ts?privacy=${gpc}-${dnt}`);
    track.trackPageView("/", "load");
    track.flushAnalytics();
    assert.equal(sent.length, 0);
  }
});

test("webdriver and a headless user agent send nothing", async () => {
  const webdriver = install({ webdriver: true });
  const first = await import("./track.ts?webdriver");
  first.trackPageView("/", "load");
  first.flushAnalytics();
  assert.equal(webdriver.sent.length, 0);

  const headless = install({ ua: "Mozilla/5.0 HeadlessChrome/124" });
  const second = await import("./track.ts?headless");
  second.trackPageView("/", "load");
  second.flushAnalytics();
  assert.equal(headless.sent.length, 0);
});

test("a session rotates after 30 minutes", async () => {
  const now = Date.UTC(2026, 10, 4, 12);
  const original = Date.now;
  Date.now = () => now;
  try {
    const { data, sent } = install();
    data.set(
      "strikehike:analytics:v1",
      JSON.stringify({
        aid: "A".repeat(22),
        created: now - 40 * 24 * 60 * 60_000,
        sid: "B".repeat(16),
        last: now - 31 * 60_000,
      }),
    );
    const track = await import("./track.ts?session");
    track.trackPageView("/", "load");
    track.flushAnalytics();
    const payload = await body(sent);
    assert.equal(payload.ev[0].pr.landing, 1);
    const stored = JSON.parse(data.get("strikehike:analytics:v1"));
    assert.notEqual(stored.sid, "B".repeat(16));
  } finally {
    Date.now = original;
  }
});

test("the ID rotates at 13 months even when visits continue", async () => {
  const now = Date.UTC(2026, 10, 4, 12);
  const original = Date.now;
  Date.now = () => now;
  try {
    const { data, sent } = install();
    data.set(
      "strikehike:analytics:v1",
      JSON.stringify({
        aid: "C".repeat(22),
        created: Date.UTC(2025, 8, 1),
        sid: "D".repeat(16),
        last: now - 60_000,
      }),
    );
    const track = await import("./track.ts?rotate");
    track.trackPageView("/", "load");
    track.flushAnalytics();
    const payload = await body(sent);
    assert.notEqual(payload.aid, "C".repeat(22));
    const stored = JSON.parse(data.get("strikehike:analytics:v1"));
    assert.equal(stored.created, now);
  } finally {
    Date.now = original;
  }
});

test("UTMs are captured, then stripped from the address bar", async () => {
  const { sent, storage } = install({
    search: "?utm_source=HN&utm_medium=community&d=2020-01-01",
  });
  const track = await import("./track.ts?utm");
  track.trackPageView("/", "load");
  assert.equal(window.location.search.includes("utm_"), false);
  assert.equal(window.location.search.includes("d=2020-01-01"), true);
  track.flushAnalytics();
  const payload = await body(sent);
  assert.equal(payload.ev[0].pr.utm_source, "hn");
  assert.deepEqual(payload.ev[0].pr.query_keys, ["d"]);
  assert.ok(storage);
});

test("a blocked localStorage falls back to an ephemeral ID", async () => {
  const { sent, storage } = install({ storageWorks: false });
  const track = await import("./track.ts?ephemeral");
  track.trackPageView("/", "load");
  track.flushAnalytics();
  const payload = await body(sent);
  assert.equal(payload.eph, 1);
  assert.ok(payload.aid);
  assert.ok(storage);
});
