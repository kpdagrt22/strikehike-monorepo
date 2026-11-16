// Every 503 the site answers carries Retry-After (OPS-hardening): 60 seconds,
// unless the backend answered 503 with a value of its own, which is passed on.
// A 503 is never cached. Pure JavaScript, imported with its extension, so the
// route handlers, the page gate and the node unit tests share one rule.

/** Seconds a client should wait before asking again after a 503. */
export const RETRY_AFTER_SECONDS = 60;

/**
 * A Retry-After value worth passing on (delta-seconds or an HTTP date), else null.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function validRetryAfter(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (/^\d{1,9}$/.test(text)) return text;
  if (/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text) && !Number.isNaN(Date.parse(text))) {
    return text;
  }
  return null;
}

/**
 * The headers for a response with `status`: a 503 gains Retry-After (the
 * upstream's own value when valid, else 60 s) and Cache-Control: no-store.
 * Other statuses are returned unchanged.
 * @param {number} status
 * @param {Record<string, string>} [headers]
 * @param {string | null} [upstreamRetryAfter]
 * @returns {Record<string, string>}
 */
export function unavailableHeaders(status, headers = {}, upstreamRetryAfter = null) {
  if (status !== 503) return headers;
  return {
    ...headers,
    "Cache-Control": "no-store",
    "Retry-After": validRetryAfter(upstreamRetryAfter) ?? String(RETRY_AFTER_SECONDS),
  };
}
