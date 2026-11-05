/**
 * In-process memo for the public, read-only proxy routes (macro history,
 * events, forecast ladder, patterns, crypto milestones).
 *
 * - Only 200 responses are stored, as the exact JSON text sent to clients.
 * - An entry is fresh for `ttlMs`. Until `maxStaleMs` it is still served while
 *   a single background refresh replaces it; a failed refresh keeps it.
 * - Concurrent requests for a missing key share one upstream load.
 * - Bodies above 4 MB are never stored (the full 11 MB weekly history passes
 *   straight through); the total is capped at 48 MB, least recently used first.
 *   The total counts two bytes per character of body and key: V8 stores any
 *   string with a non-Latin-1 character (an em dash will do) as UTF-16.
 * - The active events-bundle version is checked at most once every 60 seconds,
 *   as one shared request per process. A change clears every entry before a
 *   request is served; a failed health call keeps the cache and retries after
 *   the next interval.
 *
 * State is per server process and starts empty after a restart or deploy.
 */

export type RouteLoadResult = {
  status: number;
  body: string;
  /** Optional response headers to pass through with a cached body. */
  headers?: Record<string, string>;
};

export type RouteCachePolicy = {
  /** Serve from memory without asking upstream for this long. */
  ttlMs: number;
  /** Serve an older entry, refreshing it in the background, until this age. */
  maxStaleMs?: number;
};

export type RouteCacheResult = RouteLoadResult & {
  cache: "hit" | "stale" | "miss";
};

export type RouteCacheOptions = {
  /** Backend base URL; defaults to CHRONO_API_URL, as the proxy routes do. */
  backendUrl?: string;
  /** Test seam for the 60-second throttle. */
  now?: () => number;
  /** Test seam for the health request. */
  fetchImpl?: typeof fetch;
};

type Entry = {
  body: string;
  cost: number;
  storedAt: number;
  headers?: Record<string, string>;
};

const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;
const VERSION_CHECK_INTERVAL_MS = 60_000;
const VERSION_CHECK_TIMEOUT_MS = 2_000;

export function createRouteCache(options: RouteCacheOptions = {}) {
  const backendUrl = (
    options.backendUrl ??
    process.env.CHRONO_API_URL ??
    "http://127.0.0.1:8000"
  ).replace(/\/+$/, "");
  const now = options.now ?? (() => Date.now());
  const fetchImpl =
    options.fetchImpl ??
    ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<RouteLoadResult>>();
  let totalBytes = 0;
  // A version change bumps the generation, so a load started before it cannot
  // repopulate the cache with a response for the old bundle.
  let generation = 0;
  // undefined = no successful health read yet; null = no active bundle.
  let activeBundleVersion: string | null | undefined;
  let nextVersionCheckAt = 0;
  let versionCheck: Promise<void> | null = null;

  function remove(key: string) {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    totalBytes -= entry.cost;
  }

  function clearAll() {
    entries.clear();
    inflight.clear();
    totalBytes = 0;
    generation += 1;
  }

  // Loads are keyed by generation too: a request for the new bundle never
  // joins a load started before the version change.
  function inflightKey(key: string) {
    return `${generation}\u0000${key}`;
  }

  function store(
    key: string,
    body: string,
    headers?: Record<string, string>,
  ) {
    remove(key);
    if (Buffer.byteLength(body, "utf8") > MAX_ENTRY_BYTES) return;
    // Heap cost, not wire size; remove() subtracts the same amount.
    const cost = 2 * (body.length + key.length);
    entries.set(key, { body, cost, storedAt: now(), headers });
    totalBytes += cost;
    // Map iteration follows insertion order, so the first keys are the least
    // recently used ones.
    for (const oldestKey of entries.keys()) {
      if (totalBytes <= MAX_TOTAL_BYTES) break;
      remove(oldestKey);
    }
  }

  function load(
    key: string,
    loader: () => Promise<RouteLoadResult>,
  ): Promise<RouteLoadResult> {
    const pendingKey = inflightKey(key);
    const pending = inflight.get(pendingKey);
    if (pending) return pending;

    const startGeneration = generation;
    const next = loader()
      .then((result) => {
        if (result.status === 200 && startGeneration === generation) {
          store(key, result.body, result.headers);
        }
        return result;
      })
      .finally(() => {
        inflight.delete(pendingKey);
      });
    inflight.set(pendingKey, next);
    return next;
  }

  async function readActiveVersion(): Promise<string | null | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERSION_CHECK_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${backendUrl}/api/v1/events/health`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return undefined;
      const payload: unknown = await response.json();
      if (payload === null || typeof payload !== "object") return undefined;
      const version = (payload as { active_version?: unknown }).active_version;
      if (version === null) return null;
      return typeof version === "string" ? version : undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async function refreshActiveBundleVersion(): Promise<void> {
    const version = await readActiveVersion();
    if (version === undefined) return; // health failed: keep the cache
    const previous = activeBundleVersion;
    activeBundleVersion = version;
    if (previous !== undefined && previous !== version) clearAll();
  }

  function ensureActiveBundleVersion(): Promise<void> {
    // Every concurrent caller waits for the same in-flight check, even when
    // the 60-second window has already been claimed.
    if (versionCheck !== null) return versionCheck;
    if (now() < nextVersionCheckAt) return Promise.resolve();
    nextVersionCheckAt = now() + VERSION_CHECK_INTERVAL_MS;
    versionCheck = refreshActiveBundleVersion()
      .catch(() => {
        // A health check must never fail a proxy request.
      })
      .finally(() => {
        versionCheck = null;
      });
    return versionCheck;
  }

  async function cachedRoute(
    key: string,
    policy: RouteCachePolicy,
    loader: () => Promise<RouteLoadResult>,
  ): Promise<RouteCacheResult> {
    await ensureActiveBundleVersion();
    const entry = entries.get(key);
    if (entry) {
      const age = now() - entry.storedAt;
      const maxStaleMs = Math.max(policy.ttlMs, policy.maxStaleMs ?? 0);
      if (age < maxStaleMs) {
        entries.delete(key);
        entries.set(key, entry);
        if (age < policy.ttlMs) {
          return {
            status: 200,
            body: entry.body,
            headers: entry.headers,
            cache: "hit",
          };
        }
        if (!inflight.has(inflightKey(key))) {
          load(key, loader).catch(() => {
            // Keep serving the stale entry; the next request tries again.
          });
        }
        return {
          status: 200,
          body: entry.body,
          headers: entry.headers,
          cache: "stale",
        };
      }
      remove(key);
    }

    const result = await load(key, loader);
    return { ...result, cache: "miss" };
  }

  return { cachedRoute };
}

const defaultCache = createRouteCache();

export const cachedRoute = defaultCache.cachedRoute;

/** JSON text response; Cache-Control is sent on 200 responses only. */
export function jsonTextResponse(
  result: RouteLoadResult,
  cacheControl: string,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (result.status === 200) headers["Cache-Control"] = cacheControl;
  return new Response(result.body, { status: result.status, headers });
}

/** Text response that keeps the upstream Content-Type, Cache-Control and ETag. */
export function textResponse(
  result: RouteLoadResult,
  fallbackContentType: string,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": result.headers?.["Content-Type"] ?? fallbackContentType,
  };
  if (result.headers?.["Cache-Control"]) {
    headers["Cache-Control"] = result.headers["Cache-Control"];
  }
  if (result.headers?.ETag) headers.ETag = result.headers.ETag;
  return new Response(result.body, { status: result.status, headers });
}
