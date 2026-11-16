import assert from "node:assert/strict";
import test from "node:test";

import {
  BackendUnavailableError,
  createLastGoodStore,
  isBackendUnavailable,
  RETRY_AFTER_SECONDS,
  serviceUnavailableResponse,
} from "./lastGood.ts";

const FRESH = 60_000;

function counted(values) {
  const loader = async () => {
    loader.calls += 1;
    const next = values.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  loader.calls = 0;
  return loader;
}

test("a cold read with a failing backend throws BackendUnavailableError, not null", async () => {
  const store = createLastGoodStore();
  const loader = counted([new Error("timeout")]);
  await assert.rejects(
    store.read("atlas", FRESH, loader, "The regime atlas"),
    (error) => {
      assert.ok(isBackendUnavailable(error));
      assert.ok(error instanceof BackendUnavailableError);
      assert.equal(error.retryAfterSeconds, RETRY_AFTER_SECONDS);
      assert.match(error.message, /regime atlas is unavailable/);
      return true;
    },
  );
  assert.equal(store.has("atlas"), false);
});

test("a missing record (null) is a successful load and stays null", async () => {
  const store = createLastGoodStore();
  const loader = counted([null]);
  assert.equal(await store.read("event:x", FRESH, loader, "Event x"), null);
  assert.equal(store.has("event:x"), true);
  assert.equal(await store.read("event:x", FRESH, loader, "Event x"), null);
  assert.equal(loader.calls, 1);
});

test("a fresh value is served without asking the backend", async () => {
  let time = 0;
  const store = createLastGoodStore({ now: () => time });
  const loader = counted(["v1", "v2"]);
  assert.equal(await store.read("k", FRESH, loader, "k"), "v1");
  time = FRESH - 1;
  assert.equal(await store.read("k", FRESH, loader, "k"), "v1");
  assert.equal(loader.calls, 1);
});

test("a stale value is served at once and replaced by one background refresh", async () => {
  let time = 0;
  const store = createLastGoodStore({ now: () => time });
  let calls = 0;
  let release;
  const loader = () => {
    calls += 1;
    if (calls === 1) return Promise.resolve("v1");
    return new Promise((resolve) => {
      release = () => resolve("v2");
    });
  };
  await store.read("k", FRESH, loader, "k");
  time = FRESH;
  assert.equal(await store.read("k", FRESH, loader, "k"), "v1");
  // A second stale read while the refresh is in flight starts no other load.
  assert.equal(await store.read("k", FRESH, loader, "k"), "v1");
  assert.equal(calls, 2);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await store.read("k", FRESH, loader, "k"), "v2");
  assert.equal(calls, 2);
});

test("a failed refresh keeps the last good value, however old", async () => {
  let time = 0;
  const store = createLastGoodStore({ now: () => time });
  const loader = counted(["good", new Error("503"), new Error("timeout")]);
  await store.read("k", FRESH, loader, "k");
  time = 10 * 24 * 60 * 60_000;
  assert.equal(await store.read("k", FRESH, loader, "k"), "good");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await store.read("k", FRESH, loader, "k"), "good");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loader.calls, 3);
  assert.equal(store.has("k"), true);
});

test("concurrent cold reads share one load", async () => {
  const store = createLastGoodStore();
  let release;
  let calls = 0;
  const loader = () => {
    calls += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const reads = Array.from({ length: 5 }, () => store.read("k", FRESH, loader, "k"));
  release("shared");
  assert.deepEqual(await Promise.all(reads), Array(5).fill("shared"));
  assert.equal(calls, 1);
});

test("concurrent cold reads all fail with BackendUnavailableError on one failed load", async () => {
  const store = createLastGoodStore();
  const loader = counted([new Error("timeout")]);
  const results = await Promise.allSettled(
    Array.from({ length: 3 }, () => store.read("k", FRESH, loader, "k")),
  );
  assert.equal(loader.calls, 1);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    assert.ok(isBackendUnavailable(result.reason));
  }
  // The next read tries the backend again.
  const retry = counted(["ok"]);
  assert.equal(await store.read("k", FRESH, retry, "k"), "ok");
});

test("the least recently read key goes first past maxEntries", async () => {
  const store = createLastGoodStore({ maxEntries: 2 });
  await store.read("a", FRESH, async () => "A", "a");
  await store.read("b", FRESH, async () => "B", "b");
  await store.read("a", FRESH, async () => "A2", "a");
  await store.read("c", FRESH, async () => "C", "c");
  assert.equal(store.size(), 2);
  assert.equal(store.has("a"), true);
  assert.equal(store.has("b"), false);
  assert.equal(store.has("c"), true);
});

test("the 503 response carries Retry-After and no-store", async () => {
  const response = serviceUnavailableResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), String(RETRY_AFTER_SECONDS));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(await response.text(), /Temporarily unavailable/);
});
