import assert from "node:assert/strict";
import test from "node:test";

import { createRouteCache } from "./routeCache.ts";

function health(payload, ok = true) {
  return {
    ok,
    json: async () => payload,
  };
}

function loadBody(body, counter) {
  return async () => {
    counter.calls += 1;
    return { status: 200, body };
  };
}

test("an unchanged bundle version keeps the cache", async () => {
  let time = 0;
  let healthCalls = 0;
  const loads = { calls: 0 };
  const cache = createRouteCache({
    backendUrl: "http://backend",
    now: () => time,
    fetchImpl: async () => {
      healthCalls += 1;
      return health({ active_version: "v1" });
    },
  });
  const loader = loadBody("body-v1", loads);

  const first = await cache.cachedRoute("key", { ttlMs: 300_000 }, loader);
  assert.equal(first.cache, "miss");
  assert.equal(first.body, "body-v1");

  time = 60_001;
  const second = await cache.cachedRoute("key", { ttlMs: 300_000 }, loader);
  assert.equal(second.cache, "hit");
  assert.equal(second.body, "body-v1");
  assert.equal(healthCalls, 2);
  assert.equal(loads.calls, 1);
});

test("response headers survive a cache hit", async () => {
  let time = 0;
  const cache = createRouteCache({
    backendUrl: "http://backend",
    now: () => time,
    fetchImpl: async () => health({ active_version: "v1" }),
  });
  const loader = async () => ({
    status: 200,
    body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      ETag: '"bundle-finance"',
    },
  });

  const first = await cache.cachedRoute("calendar", { ttlMs: 300_000 }, loader);
  assert.equal(first.cache, "miss");
  time = 1_000;
  const second = await cache.cachedRoute("calendar", { ttlMs: 300_000 }, loader);
  assert.equal(second.cache, "hit");
  assert.equal(second.headers?.ETag, '"bundle-finance"');
  assert.equal(second.headers?.["Content-Type"], "text/calendar; charset=utf-8");
});

test("a changed bundle version clears every entry exactly once", async () => {
  let time = 0;
  let version = "v1";
  let healthCalls = 0;
  const loadsA = { calls: 0 };
  const loadsB = { calls: 0 };
  const cache = createRouteCache({
    backendUrl: "http://backend",
    now: () => time,
    fetchImpl: async () => {
      healthCalls += 1;
      return health({ active_version: version });
    },
  });

  const firstA = await cache.cachedRoute(
    "a",
    { ttlMs: 300_000 },
    loadBody("a-v1", loadsA),
  );
  const firstB = await cache.cachedRoute(
    "b",
    { ttlMs: 300_000 },
    loadBody("b-v1", loadsB),
  );
  assert.equal(firstA.cache, "miss");
  assert.equal(firstB.cache, "miss");

  version = "v2";
  time = 60_001;
  const secondA = await cache.cachedRoute(
    "a",
    { ttlMs: 300_000 },
    loadBody("a-v2", loadsA),
  );
  const secondB = await cache.cachedRoute(
    "b",
    { ttlMs: 300_000 },
    loadBody("b-v2", loadsB),
  );
  assert.equal(secondA.cache, "miss");
  assert.equal(secondA.body, "a-v2");
  assert.equal(secondB.cache, "miss");
  assert.equal(secondB.body, "b-v2");
  assert.equal(healthCalls, 2);

  time = 60_002;
  const thirdA = await cache.cachedRoute(
    "a",
    { ttlMs: 300_000 },
    loadBody("never", loadsA),
  );
  assert.equal(thirdA.cache, "hit");
  assert.equal(thirdA.body, "a-v2");
  assert.equal(healthCalls, 2);
  assert.deepEqual(
    { a: loadsA.calls, b: loadsB.calls },
    { a: 2, b: 2 },
  );
});

test("a failed health call keeps the cache and retries after the interval", async () => {
  let time = 0;
  let healthCalls = 0;
  let failure = null;
  const loads = { calls: 0 };
  const cache = createRouteCache({
    backendUrl: "http://backend",
    now: () => time,
    fetchImpl: async () => {
      healthCalls += 1;
      if (failure === "throw") throw new Error("health unavailable");
      if (failure === "http") return health({}, false);
      return health({ active_version: "v1" });
    },
  });
  const loader = loadBody("body-v1", loads);

  await cache.cachedRoute("key", { ttlMs: 600_000 }, loader);
  failure = "throw";
  time = 60_001;
  const failed = await cache.cachedRoute("key", { ttlMs: 600_000 }, loader);
  assert.equal(failed.cache, "hit");
  assert.equal(failed.body, "body-v1");
  assert.equal(healthCalls, 2);
  assert.equal(loads.calls, 1);

  time = 60_002;
  const throttled = await cache.cachedRoute("key", { ttlMs: 600_000 }, loader);
  assert.equal(throttled.cache, "hit");
  assert.equal(healthCalls, 2);

  failure = "http";
  time = 120_001;
  const httpFailure = await cache.cachedRoute("key", { ttlMs: 600_000 }, loader);
  assert.equal(httpFailure.cache, "hit");
  assert.equal(healthCalls, 3);

  failure = null;
  time = 180_001;
  const recovered = await cache.cachedRoute("key", { ttlMs: 600_000 }, loader);
  assert.equal(recovered.cache, "hit");
  assert.equal(healthCalls, 4);
  assert.equal(loads.calls, 1);
});

test("concurrent calls share one version check per 60-second window", async () => {
  let time = 0;
  let version = "v1";
  let healthCalls = 0;
  const loads = { calls: 0 };
  const cache = createRouteCache({
    backendUrl: "http://backend",
    now: () => time,
    fetchImpl: async () => {
      healthCalls += 1;
      return health({ active_version: version });
    },
  });

  const firstWave = await Promise.all(
    Array.from({ length: 12 }, () =>
      cache.cachedRoute("key", { ttlMs: 300_000 }, loadBody("body-v1", loads)),
    ),
  );
  assert.equal(healthCalls, 1);
  assert.equal(loads.calls, 1);
  assert.ok(firstWave.every((result) => result.body === "body-v1"));

  version = "v2";
  time = 60_001;
  const secondWave = await Promise.all(
    Array.from({ length: 12 }, () =>
      cache.cachedRoute("key", { ttlMs: 300_000 }, loadBody("body-v2", loads)),
    ),
  );
  assert.equal(healthCalls, 2);
  assert.equal(loads.calls, 2);
  assert.ok(secondWave.every((result) => result.body === "body-v2"));
});
