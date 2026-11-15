import assert from "node:assert/strict";
import test from "node:test";
import {
  hasThreeChunk,
  headerChecks,
  posterCheck,
  scriptsFromHtml,
} from "./verify-live.mjs";

const HTML = `
<html><head>
<script src="/_next/static/chunks/a.js"></script>
<script src="/_next/static/chunks/b.js"></script>
<script src="https://example.com/tracker.js"></script>
</head></html>`;

test("scriptsFromHtml keeps unique Next scripts only", () => {
  assert.deepEqual(scriptsFromHtml(HTML), [
    "/_next/static/chunks/a.js",
    "/_next/static/chunks/b.js",
  ]);
  assert.deepEqual(scriptsFromHtml("<p>no scripts</p>"), []);
});

test("hasThreeChunk detects the renderer marker", () => {
  assert.equal(hasThreeChunk(["nothing"]), false);
  assert.equal(hasThreeChunk(["x WebGLRenderer y"]), true);
});

test("posterCheck passes only when no initial script carries three.js", () => {
  assert.equal(posterCheck(HTML, ["plain", "plain"]).ok, true);
  assert.equal(posterCheck(HTML, ["plain", "WebGLRenderer"]).ok, false);
  assert.equal(posterCheck("<p>none</p>", []).ok, false);
});

test("headerChecks requires HSTS, nosniff, referrer, CSP report-to and Reporting-Endpoints", () => {
  const good = new Headers({
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "content-security-policy-report-only": "default-src 'self'; report-to csp-endpoint",
    "reporting-endpoints": 'csp-endpoint="https://strikehike.com/api/v1/csp-report"',
  });
  assert.deepEqual(headerChecks(good).map((item) => item.ok), [true, true, true, true, true]);

  const bad = new Headers({ "content-security-policy-report-only": "default-src 'self'" });
  assert.deepEqual(headerChecks(bad).map((item) => item.ok), [false, false, false, false, false]);
});
