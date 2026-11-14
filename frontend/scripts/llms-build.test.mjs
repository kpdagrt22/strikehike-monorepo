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

test("the committed llms.txt matches the generator", async () => {
  const text = await buildLlms();
  const file = await readFile("public/llms.txt", "utf8");
  assert.equal(file, text);
});
