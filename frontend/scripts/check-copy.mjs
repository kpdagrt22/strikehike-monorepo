#!/usr/bin/env node
// Compliance guard: no advice, allocation, forecast or unexplained-percentage
// wording may reach the frontend's user-facing strings. The scan is deliberately
// strict (it reads comments too), so a sentence that must never ship cannot
// survive in a nearby comment either.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "src");
const ROUNDUPS = path.resolve(HERE, "..", "content", "roundups");
const ROOTS = [ROOT, ROUNDUPS];
const EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".css",
  ".json",
  ".md",
  ".mdx",
  ".txt",
  ".html",
]);

const BANNED = [
  "smart money",
  "% equity",
  "% defensive",
  "trim equities",
  "accumulation",
  "contrarian playbook",
  "forecast unavailable",
  "ml index insight",
  "future ladder",
  "trim into",
  "accumulate into",
  "contrarian",
  "expected to",
  "is likely to",
  "we expect",
  "next week will",
  "this week will",
  "will rise",
  "will fall",
];

async function* files(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* files(full);
    } else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield full;
    }
  }
}

const hits = [];
for (const root of ROOTS) {
  for await (const file of files(root)) {
    const text = await readFile(file, "utf8");
    const lower = text.toLowerCase();
    const lines = text.split(/\r?\n/);
    for (const phrase of BANNED) {
      let at = lower.indexOf(phrase);
      while (at !== -1) {
        const line = lower.slice(0, at).split("\n").length;
        hits.push({
          file: path.relative(path.resolve(HERE, ".."), file).replaceAll("\\", "/"),
          line,
          phrase,
          text: lines[line - 1]?.trim() ?? "",
        });
        at = lower.indexOf(phrase, at + phrase.length);
      }
    }
  }
}

if (hits.length > 0) {
  console.error("Copy guard failed: banned advice/forecast wording found.");
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  "${hit.phrase}"  ${hit.text}`);
  }
  process.exit(1);
}

console.log(
  `Copy guard passed (${BANNED.length} phrases, ${ROOTS.map((root) => path.relative(path.resolve(HERE, ".."), root)).join(" + ")}).`,
);
