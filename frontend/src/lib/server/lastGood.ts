/**
 * Last-good memo for the backend reads behind server-rendered detail pages
 * (lib/server/pageData.ts).
 *
 * - A loaded value (including `null`, "no such record") is fresh for `freshMs`.
 * - After that it is still served at once while one background refresh
 *   replaces it; a failed refresh keeps it. A value is never dropped for age,
 *   so a slow or failing backend cannot take a page that loaded once.
 * - Concurrent reads of a missing key share one load.
 * - With nothing stored and a failed load, the read throws
 *   `BackendUnavailableError`: the caller answers 503, never 404.
 * - At most `maxEntries` keys, least recently used first out.
 *
 * State is per server process and starts empty after a restart or deploy.
 */

/** Seconds a client should wait before asking again after a 503. */
export const RETRY_AFTER_SECONDS = 60;

/** The backend could not answer and there is no earlier copy to serve. */
export class BackendUnavailableError extends Error {
  readonly retryAfterSeconds: number;

  constructor(what: string, cause?: unknown) {
    super(`${what} is unavailable`, { cause });
    this.name = "BackendUnavailableError";
    this.retryAfterSeconds = RETRY_AFTER_SECONDS;
  }
}

export function isBackendUnavailable(error: unknown): error is BackendUnavailableError {
  return (
    error instanceof BackendUnavailableError ||
    (error instanceof Error && error.name === "BackendUnavailableError")
  );
}

/** A plain-text 503 for route handlers (share cards) whose data did not load. */
export function serviceUnavailableResponse(body = "Temporarily unavailable\n"): Response {
  return new Response(body, {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": String(RETRY_AFTER_SECONDS),
    },
  });
}

export type LastGoodOptions = {
  /** Keys kept at most; the least recently read goes first. */
  maxEntries?: number;
  /** Test seam for the clock. */
  now?: () => number;
};

type Entry = { value: unknown; storedAt: number };

export function createLastGoodStore(options: LastGoodOptions = {}) {
  const maxEntries = Math.max(1, options.maxEntries ?? 500);
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<unknown>>();

  function remember(key: string, value: unknown) {
    entries.delete(key);
    entries.set(key, { value, storedAt: now() });
    // Map iteration follows insertion order: the first key is the least
    // recently read one.
    for (const oldest of entries.keys()) {
      if (entries.size <= maxEntries) break;
      entries.delete(oldest);
    }
  }

  function load<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
    const next = loader()
      .then((value) => {
        remember(key, value);
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, next);
    return next;
  }

  /**
   * The stored value for `key`, refreshed in the background once it is older
   * than `freshMs`; with nothing stored, one shared load. `what` names the
   * data in the error a failed cold load throws.
   */
  async function read<T>(
    key: string,
    freshMs: number,
    loader: () => Promise<T>,
    what: string,
  ): Promise<T> {
    const entry = entries.get(key);
    if (entry) {
      entries.delete(key);
      entries.set(key, entry);
      if (now() - entry.storedAt >= freshMs && !inflight.has(key)) {
        load(key, loader).catch(() => {
          // Keep serving the last good value; the next stale read tries again.
        });
      }
      return entry.value as T;
    }
    try {
      return await load(key, loader);
    } catch (error) {
      throw new BackendUnavailableError(what, error);
    }
  }

  return {
    read,
    /** True when a value (fresh or not) is stored for `key`. */
    has: (key: string) => entries.has(key),
    size: () => entries.size,
    clear: () => {
      entries.clear();
      inflight.clear();
    },
  };
}

export type LastGoodStore = ReturnType<typeof createLastGoodStore>;
