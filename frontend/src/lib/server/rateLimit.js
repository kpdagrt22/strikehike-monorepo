// In-memory token buckets for the public proxy routes. Pure JavaScript: the
// Next proxy supplies the client key and the daily flag; this module only does
// the arithmetic and the eviction.

export const API_LIMIT_PER_MINUTE = 240;
export const DAILY_LIMIT_PER_MINUTE = 60;
export const IDLE_BUCKET_MS = 10 * 60_000;
export const MAX_BUCKETS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

/** First X-Forwarded-For entry (Caddy sets it), else the direct/real IP. */
export function clientIpFromHeaders(headers, directIp) {
  const forwarded = headers?.get?.("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  if (typeof directIp === "string" && directIp) return directIp;
  const real = headers?.get?.("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

function refill(bucket, capacity, perMinute, now) {
  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(
    capacity,
    bucket.tokens + (elapsed * perMinute) / 60_000,
  );
  bucket.updatedAt = now;
}

function retrySeconds(bucket, perMinute) {
  const missing = Math.max(0, 1 - bucket.tokens);
  return Math.max(1, Math.ceil((missing * 60_000) / perMinute / 1000));
}

export function createRateLimiter({
  apiPerMinute = API_LIMIT_PER_MINUTE,
  dailyPerMinute = DAILY_LIMIT_PER_MINUTE,
  idleMs = IDLE_BUCKET_MS,
  maxKeys = MAX_BUCKETS,
  now = () => Date.now(),
} = {}) {
  const buckets = new Map();
  let lastSweep = now();

  function sweep(nowMs) {
    if (nowMs - lastSweep < SWEEP_INTERVAL_MS) return;
    lastSweep = nowMs;
    for (const [ip, state] of buckets) {
      if (nowMs - state.lastSeen >= idleMs) buckets.delete(ip);
    }
  }

  function bucketFor(nowMs) {
    return {
      tokens: 0,
      updatedAt: nowMs,
    };
  }

  function stateFor(ip, nowMs) {
    sweep(nowMs);
    let state = buckets.get(ip);
    if (!state) {
      if (buckets.size >= maxKeys) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      state = {
        api: { ...bucketFor(nowMs), tokens: apiPerMinute },
        daily: { ...bucketFor(nowMs), tokens: dailyPerMinute },
        lastSeen: nowMs,
      };
    }
    // Map insertion order is the LRU order.
    buckets.delete(ip);
    buckets.set(ip, state);
    return state;
  }

  function consume(ip, daily = false) {
    const nowMs = now();
    const state = stateFor(ip, nowMs);
    state.lastSeen = nowMs;

    refill(state.api, apiPerMinute, apiPerMinute, nowMs);
    if (daily) {
      refill(state.daily, dailyPerMinute, dailyPerMinute, nowMs);
    }

    const apiBlocked = state.api.tokens < 1;
    const dailyBlocked = daily && state.daily.tokens < 1;
    if (apiBlocked || dailyBlocked) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          apiBlocked ? retrySeconds(state.api, apiPerMinute) : 0,
          dailyBlocked ? retrySeconds(state.daily, dailyPerMinute) : 0,
        ),
      };
    }

    state.api.tokens -= 1;
    if (daily) state.daily.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    consume,
    size: () => buckets.size,
  };
}

export const rateLimit = createRateLimiter();
