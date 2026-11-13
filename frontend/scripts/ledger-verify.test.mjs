import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalJson,
  ledgerHash,
  LedgerError,
  verifyLedgerText,
} from "./ledger-verify.mjs";

const vectorUrl = new URL("../../tests/fixtures/ledger/vector.json", import.meta.url);
const ledgerUrl = new URL("../content/ledger/ledger.jsonl", import.meta.url);

test("the Node canonical bytes and hashes match the shared vectors", async () => {
  const { vectors } = JSON.parse(await readFile(vectorUrl, "utf8"));
  for (const vector of vectors) {
    const payload = { ...vector.entry };
    delete payload.hash;
    assert.equal(canonicalJson(payload), vector.canonical);
    assert.equal(ledgerHash(vector.entry), vector.hash);
  }
});

test("the real ledger verifies", async () => {
  const entries = verifyLedgerText(await readFile(ledgerUrl, "utf8"));
  assert.ok(entries.length >= 1);
  assert.equal(entries[0].seq, 1);
});

test("a tampered field breaks at its seq", async () => {
  const text = await readFile(ledgerUrl, "utf8");
  const lines = text.trimEnd().split(/\r?\n/);
  const first = JSON.parse(lines[0]);
  first.reading.core_index = 99.9;
  lines[0] = JSON.stringify(first);
  assert.throws(
    () => verifyLedgerText(lines.join("\n")),
    (error) => error instanceof LedgerError && error.seq === 1,
  );
});
