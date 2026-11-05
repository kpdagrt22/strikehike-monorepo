/* First-party page/event beacon. No dependencies, no cookies, no third parties. */

const KEY = "strikehike:analytics:v1";
const OPTOUT = "strikehike:analytics:optout";
const MAX_VISIBLE_MS = 1_800_000;
const BOT_UA =
  /HeadlessChrome|Lighthouse|PageSpeed|GTmetrix|Puppeteer|Playwright|Selenium|PhantomJS/i;
const QUERY_KEYS = ["d", "themes", "a", "b", "series", "span", "case"];

type Ident = { aid: string; created: number; sid: string; last: number };
type Event = { n: string; t: number; pv: string; p: string; pr: Record<string, unknown> };
type Vis = { pv: string; ms: number; lcp?: number; inp?: number; cls?: number };

let memory: Ident | null = null;
let ephemeral = false;
let queue: Event[] = [];
let visible = 0;
let visibleSince = 0;
let started = false;
let pv = "";
let path = "/";
let createdNow = 0;
let sessionNew = 0;
let lcp = 0;
let inp = 0;
let cls = 0;
let lastKey = "";
let lastAt = 0;
// Web Vitals describe the hard load only: they ride on the first page view.
let rumPv = "";
// Visibility-only beacons: at most one a minute, and only when time moved.
let sentMs = 0;
let sentAt = 0;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    ephemeral = true;
    return null;
  }
}

function readIdent(): Ident | null {
  const store = storage();
  if (!store) return memory;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return memory;
    const value = JSON.parse(raw);
    if (
      /^[\w-]{22}$/.test(value?.aid) &&
      typeof value?.created === "number" &&
      /^[\w-]{16}$/.test(value?.sid) &&
      typeof value?.last === "number"
    ) {
      return value;
    }
  } catch {
    ephemeral = true;
  }
  return memory;
}

function writeIdent(value: Ident) {
  memory = value;
  const store = storage();
  if (!store) {
    ephemeral = true;
    return;
  }
  try {
    store.setItem(KEY, JSON.stringify(value));
  } catch {
    ephemeral = true;
  }
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// One random byte per character; 64 and 16 both divide 256, so no bias.
function randomText(length: number, alphabet = B64) {
  const data = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(data, (byte) => alphabet[byte % alphabet.length]).join("");
}

function rotated(created: number, now: number) {
  const date = new Date(created);
  date.setUTCMonth(date.getUTCMonth() + 13);
  return now >= date.getTime();
}

/** A fresh anonymous ID and session (the opt-in switch calls this too). */
export function resetIdentity(now = Date.now()) {
  const value = { aid: randomText(22), created: now, sid: randomText(16), last: now };
  writeIdent(value);
  return value;
}

function identity(now: number) {
  let value = readIdent();
  createdNow = 0;
  sessionNew = 0;
  if (!value || rotated(value.created, now)) {
    value = resetIdentity(now);
    createdNow = 1;
    sessionNew = 1;
  } else if (now - value.last >= 1_800_000) {
    value = { ...value, sid: randomText(16), last: now };
    sessionNew = 1;
    writeIdent(value);
  }
  // An unchanged identity needs no write: touch() refreshes `last`.
  return value;
}

function optedOut() {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(OPTOUT) === "1";
  } catch {
    return false;
  }
}

function browserBlocks() {
  try {
    return (
      (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true ||
      navigator.doNotTrack === "1"
    );
  } catch {
    return false;
  }
}

function enabled() {
  return process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "1";
}

function allowed() {
  if (!enabled() || typeof navigator === "undefined" || typeof document === "undefined")
    return false;
  if (navigator.webdriver === true) return false;
  if (BOT_UA.test(navigator.userAgent || "")) return false;
  if (optedOut() || browserBlocks()) return false;
  return true;
}

function stripUtms() {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_")) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  } catch {
    // URL hygiene must never break the page.
  }
}

function landingProps() {
  const props: Record<string, unknown> = {};
  try {
    const params = new URLSearchParams(window.location.search);
    const keys = QUERY_KEYS.filter((key) => params.has(key));
    if (keys.length) props.query_keys = keys;
    for (const key of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
    ]) {
      const value = params.get(key);
      if (value) {
        props[key] = value
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, "-")
          .slice(0, 64);
      }
    }
    const referrer = document.referrer;
    if (referrer) {
      const host = new URL(referrer).host;
      if (host && host !== window.location.host) {
        props.referrer_host = host.slice(0, 160);
      }
    }
  } catch {
    // Partial landing data is better than none.
  }
  return props;
}

function touch(now: number) {
  const value = readIdent();
  if (value) {
    value.last = now;
    writeIdent(value);
  }
  return value;
}

function tick(now: number) {
  if (!pv || !visibleSince) return;
  visible = Math.min(MAX_VISIBLE_MS, visible + Math.max(0, now - visibleSince));
  visibleSince = document.visibilityState === "hidden" ? 0 : now;
}

function send(body: unknown) {
  try {
    const text = JSON.stringify(body);
    if (navigator.sendBeacon) {
      const blob = new Blob([text], { type: "text/plain" });
      if (navigator.sendBeacon("/api/v1/usage", blob)) return;
    }
    // A string body is sent as text/plain, and the site sets no cookies.
    fetch("/api/v1/usage", { method: "POST", body: text, keepalive: true }).catch(
      () => {},
    );
  } catch {
    // A lost batch is acceptable.
  }
}

// `final`: the page is being hidden, left or replaced, so send visible time
// now. Otherwise visible time goes out at most once a minute.
export function flushAnalytics(final?: unknown) {
  if (!allowed()) {
    queue = [];
    return;
  }
  const now = Date.now();
  tick(now);
  const ms = Math.round(visible);
  const rum = pv === rumPv;
  const vis: Vis | null =
    pv && ms - sentMs >= 1000 && (final === true || now - sentAt >= 60_000)
      ? {
          pv,
          ms,
          ...(rum && lcp ? { lcp } : {}),
          ...(rum && inp ? { inp } : {}),
          ...(rum && cls ? { cls: Math.round(cls * 1000) } : {}),
        }
      : null;
  if (!queue.length && !vis) return;
  const value = touch(now);
  if (!value) return;
  const events = queue.slice(0, 25);
  queue = queue.slice(25);
  if (vis) {
    sentMs = ms;
    sentAt = now;
  }
  send({
    v: 1,
    aid: value.aid,
    sid: value.sid,
    new: createdNow,
    eph: ephemeral ? 1 : 0,
    ctx: {
      vw: window.innerWidth || 0,
      tz: (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        } catch {
          return "";
        }
      })(),
      app: (process.env.NEXT_PUBLIC_BUILD_SHA || "dev").slice(0, 7),
    },
    ev: events,
    ...(vis ? { vis: [vis] } : {}),
  });
}

function start() {
  if (started) return;
  started = true;
  window.setInterval(flushAnalytics, 5000);
  const hidden = () => {
    if (document.visibilityState === "hidden") flushAnalytics(true);
    else if (pv) visibleSince = Date.now();
  };
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("pagehide", () => flushAnalytics(true));
  if (typeof PerformanceObserver !== "undefined") {
    import("./rum")
      .then(({ observeRum }) =>
        observeRum((nextLcp, nextInp, nextCls) => {
          lcp = nextLcp;
          inp = nextInp;
          cls = nextCls;
        }),
      )
      .catch(() => {});
  }
}

export function trackPageView(nextPath: string, navType: "load" | "client" | "back_forward") {
  const landing = landingProps();
  stripUtms();
  if (typeof document !== "undefined" && (document as Document & { prerendering?: boolean }).prerendering) {
    document.addEventListener(
      "prerenderingchange",
      () => trackPageView(nextPath, navType),
      { once: true },
    );
    return;
  }
  if (!allowed()) return;
  // Close out the page being left before its counters reset.
  if (pv) flushAnalytics(true);
  const now = Date.now();
  identity(now);
  pv = randomText(12, "0123456789abcdef");
  rumPv ||= pv;
  path = nextPath;
  visible = 0;
  visibleSince = now;
  sentMs = 0;
  sentAt = now;
  const first = createdNow || sessionNew;
  queue.push({
    n: "page_viewed",
    t: now,
    pv,
    p: path,
    pr: { nav_type: navType, landing: first ? 1 : 0, ...(first ? landing : {}) },
  });
  touch(now);
  start();
  if (queue.length >= 25) flushAnalytics();
}

export function trackEvent(name: string, props: Record<string, unknown> = {}) {
  if (!allowed() || !pv) return;
  const now = Date.now();
  const key = name + JSON.stringify(props);
  if (key === lastKey && now - lastAt < 2_000) return;
  lastKey = key;
  lastAt = now;
  touch(now);
  queue.push({ n: name, t: now, pv, p: path, pr: props });
  if (queue.length >= 25) flushAnalytics();
}
