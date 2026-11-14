import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildLlms } from "./llms-build.mjs";
import { PAGES, absoluteUrl } from "../src/lib/seo/site.ts";

test("llms.txt contains every route in PAGES", async () => {
  const text = await buildLlms();
  for (const path of Object.keys(PAGES)) {
    assert.ok(text.includes(absoluteUrl(path)), path);
  }
});

test("llms.txt carries definitions, data sources and the correct declines wording", async () => {
  const text = await buildLlms();
  assert.match(text, /## Definitions/);
  assert.match(text, /Market decline \(Convergence\)/);
  assert.match(text, /120-year mirror \(Study of Patterns\)/);
  assert.match(text, /## Data sources/);
  assert.match(text, /Swiss Ephemeris 2\.10\.03/);
  assert.match(text, /github\.com\/kpdagrt22\/strikehike-monorepo/);
  assert.match(text, /20% or more in the daily S&P 500 since 1928/);
  assert.match(text, /Seven popular sky claims/);
  assert.doesNotMatch(text, /Market declines since 1871, compared side by side/);
});

test("the committed llms.txt matches the generator", async () => {
  const text = await buildLlms();
  const file = await readFile("public/llms.txt", "utf8");
  assert.equal(file, text);
});
