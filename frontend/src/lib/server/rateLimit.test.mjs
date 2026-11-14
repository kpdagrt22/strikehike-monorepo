import assert from "node:assert/strict";
import test from "node:test";

import {
  clientIpFromHeaders,
  createRateLimiter,
  DAILY_LIMIT_PER_MINUTE,
  API_LIMIT_PER_MINUTE,
  CHRONO_LIMIT_PER_MINUTE,
  ROUTE_LIMITS,
  SKY_LIMIT_PER_MINUTE,
} from "./rateLimit.js";

test("the general API bucket allows 240 requests a minute", () => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time });

  for (let index = 0; index < API_LIMIT_PER_MINUTE; index += 1) {
    assert.equal(limiter.consume("1.2.3.4").allowed, true, `request ${index + 1}`);
  }
  const blocked = limiter.consume("1.2.3.4");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);

  time = 60_000;
  assert.equal(limiter.consume("1.2.3.4").allowed, true);
});

test("daily requests have their own 60-request bucket", () => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time });

  for (let index = 0; index < DAILY_LIMIT_PER_MINUTE; index += 1) {
    assert.equal(limiter.consume("1.2.3.4", true).allowed, true, `daily ${index + 1}`);
  }
  const blocked = limiter.consume("1.2.3.4", true);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);

  // The general bucket still has tokens, and a non-daily request can use them.
  assert.equal(limiter.consume("1.2.3.4", false).allowed, true);
});

test("the sky week route has its own 30-request bucket", () => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time });
  const route = "/api/v1/sky/week";
  assert.equal(ROUTE_LIMITS[route], 30);
  assert.equal(SKY_LIMIT_PER_MINUTE, 30);

  for (let index = 0; index < SKY_LIMIT_PER_MINUTE; index += 1) {
    assert.equal(
      limiter.consume("sky-client", false, route).allowed,
      true,
      `sky ${index + 1}`,
    );
  }
  const blocked = limiter.consume("sky-client", false, route);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);

  // Another client and another route are unaffected.
  assert.equal(limiter.consume("other-client", false, route).allowed, true);
  assert.equal(
    limiter.consume("sky-client", false, "/api/chrono/positions").allowed,
    true,
  );

  time = 60_000;
  assert.equal(limiter.consume("sky-client", false, route).allowed, true);
});

test("the chrono positions route has its own 120-request bucket", () => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time });
  const route = "/api/chrono/positions";
  assert.equal(ROUTE_LIMITS[route], 120);
  assert.equal(CHRONO_LIMIT_PER_MINUTE, 120);

  for (let index = 0; index < CHRONO_LIMIT_PER_MINUTE; index += 1) {
    assert.equal(
      limiter.consume("chrono-client", false, route).allowed,
      true,
      `chrono ${index + 1}`,
    );
  }
  const blocked = limiter.consume("chrono-client", false, route);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);

  time = 60_000;
  assert.equal(limiter.consume("chrono-client", false, route).allowed, true);
});

test("idle buckets are evicted after ten minutes", () => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time });
  limiter.consume("old-a");
  limiter.consume("old-b");
  assert.equal(limiter.size(), 2);

  time = 11 * 60_000;
  limiter.consume("new");
  assert.equal(limiter.size(), 1);
});

test("the bucket map is capped at maxKeys", () => {
  let time = 0;
  const limiter = createRateLimiter({ now: () => time, maxKeys: 3 });
  limiter.consume("a");
  limiter.consume("b");
  limiter.consume("c");
  limiter.consume("d");
  assert.equal(limiter.size(), 3);
});

test("the client key is the first forwarded address, then the real IP", () => {
  const headers = (values) => ({ get: (name) => values[name] ?? null });

  assert.equal(
    clientIpFromHeaders(
      headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.2", "x-real-ip": "10.0.0.2" }),
      "127.0.0.1",
    ),
    "203.0.113.7",
  );
  assert.equal(
    clientIpFromHeaders(headers({ "x-real-ip": "198.51.100.4" }), null),
    "198.51.100.4",
  );
  assert.equal(clientIpFromHeaders(headers({}), "127.0.0.1"), "127.0.0.1");
  assert.equal(
    clientIpFromHeaders(headers({ "x-real-ip": "198.51.100.4" }), "127.0.0.1"),
    "127.0.0.1",
  );
});
