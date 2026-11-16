import assert from "node:assert/strict";
import test from "node:test";

import { RETRY_AFTER_SECONDS, unavailableHeaders, validRetryAfter } from "./unavailable.js";
import { jsonTextResponse, textResponse } from "./routeCache.ts";
import { RETRY_AFTER_SECONDS as LAST_GOOD_RETRY, serviceUnavailableResponse } from "./lastGood.ts";

test("one Retry-After default, shared with the last-good memo", () => {
  assert.equal(RETRY_AFTER_SECONDS, 60);
  assert.equal(LAST_GOOD_RETRY, RETRY_AFTER_SECONDS);
  assert.equal(serviceUnavailableResponse().headers.get("retry-after"), "60");
});

test("a 503 gains Retry-After: 60 and no-store; other statuses are untouched", () => {
  const base = { "Content-Type": "application/json" };
  assert.deepEqual(unavailableHeaders(503, base), {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Retry-After": "60",
  });
  for (const status of [200, 204, 304, 404, 422, 429, 500, 502]) {
    assert.equal(unavailableHeaders(status, base), base, `status ${status}`);
  }
  // A cacheable header set on a 503 by mistake is replaced, never kept.
  assert.equal(
    unavailableHeaders(503, { "Cache-Control": "public, max-age=300" })["Cache-Control"],
    "no-store",
  );
  assert.deepEqual(unavailableHeaders(503), { "Cache-Control": "no-store", "Retry-After": "60" });
});

test("the backend's own Retry-After is kept when it is valid", () => {
  assert.equal(unavailableHeaders(503, {}, "120")["Retry-After"], "120");
  assert.equal(unavailableHeaders(503, {}, " 5 ")["Retry-After"], "5");
  const date = "Wed, 21 Oct 2026 07:28:00 GMT";
  assert.equal(unavailableHeaders(503, {}, date)["Retry-After"], date);
  for (const junk of ["", "soon", "-5", "1e3", "12.5", "Wed, 99 Oct 2026 07:28:00 GMT", "1234567890"]) {
    assert.equal(validRetryAfter(junk), null, junk);
    assert.equal(unavailableHeaders(503, {}, junk)["Retry-After"], "60", junk);
  }
  assert.equal(validRetryAfter(null), null);
  assert.equal(validRetryAfter(undefined), null);
});

test("route-cache responses: a 503 carries Retry-After and no-store, a 200 keeps its cache policy", () => {
  const unavailable = jsonTextResponse({ status: 503, body: "{}" }, "public, max-age=300");
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("retry-after"), "60");
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.equal(unavailable.headers.get("content-type"), "application/json");

  const ok = jsonTextResponse({ status: 200, body: "{}" }, "public, max-age=300");
  assert.equal(ok.headers.get("retry-after"), null);
  assert.equal(ok.headers.get("cache-control"), "public, max-age=300");

  const missing = jsonTextResponse({ status: 404, body: "{}" }, "public, max-age=300");
  assert.equal(missing.headers.get("retry-after"), null);
  assert.equal(missing.headers.get("cache-control"), null);

  const calendar = textResponse({ status: 503, body: "Unavailable" }, "text/calendar; charset=utf-8");
  assert.equal(calendar.headers.get("retry-after"), "60");
  assert.equal(calendar.headers.get("cache-control"), "no-store");
  assert.equal(calendar.headers.get("content-type"), "text/calendar; charset=utf-8");

  const specific = jsonTextResponse(
    { status: 503, body: "{}", headers: { "Retry-After": "90" } },
    "public, max-age=300",
  );
  assert.equal(specific.headers.get("retry-after"), "90");
});
