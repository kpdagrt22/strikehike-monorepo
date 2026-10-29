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
 *
 * State is per server process and starts empty after a restart or deploy.
 */

export type RouteLoadResult = {
  status: number;
  body: string;
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

type Entry = { body: string; cost: number; storedAt: number };

const MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<RouteLoadResult>>();
let totalBytes = 0;

function remove(key: string) {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  totalBytes -= entry.cost;
}

function store(key: string, body: string) {
  remove(key);
  if (Buffer.byteLength(body, "utf8") > MAX_ENTRY_BYTES) return;
  // Heap cost, not wire size; remove() subtracts the same amount.
  const cost = 2 * (body.length + key.length);
  entries.set(key, { body, cost, storedAt: Date.now() });
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
  const pending = inflight.get(key);
  if (pending) return pending;

  const next = loader()
    .then((result) => {
      if (result.status === 200) store(key, result.body);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, next);
  return next;
}

export async function cachedRoute(
  key: string,
  policy: RouteCachePolicy,
  loader: () => Promise<RouteLoadResult>,
): Promise<RouteCacheResult> {
  const entry = entries.get(key);
  if (entry) {
    const age = Date.now() - entry.storedAt;
    const maxStaleMs = Math.max(policy.ttlMs, policy.maxStaleMs ?? 0);
    if (age < maxStaleMs) {
      entries.delete(key);
      entries.set(key, entry);
      if (age < policy.ttlMs) {
        return { status: 200, body: entry.body, cache: "hit" };
      }
      if (!inflight.has(key)) {
        load(key, loader).catch(() => {
          // Keep serving the stale entry; the next request tries again.
        });
      }
      return { status: 200, body: entry.body, cache: "stale" };
    }
    remove(key);
  }

  const result = await load(key, loader);
  return { ...result, cache: "miss" };
}

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
