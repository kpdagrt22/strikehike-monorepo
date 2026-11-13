// Node twin of backend/src/astro_finance/ledger/canonical.py.
// The shared vector in tests/fixtures/ledger/vector.json proves the bytes.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const ZERO_HASH = "0".repeat(64);

export function canonicalJson(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TypeError("non-integer numbers are not allowed");
    }
    return JSON.stringify(String(value));
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const parts = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${parts.join(",")}}`;
  }
  throw new TypeError(`unsupported value: ${typeof value}`);
}

export function ledgerHash(entry) {
  const payload = { ...entry };
  delete payload.hash;
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

export class LedgerError extends Error {
  constructor(seq, message) {
    super(message);
    this.seq = seq;
  }
}

export function verifyLedgerText(text) {
  const entries = [];
  let previous = ZERO_HASH;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new LedgerError(entries.length + 1, `line ${index + 1} is not JSON`);
    }
    const seq = entry?.seq;
    if (seq !== entries.length + 1) {
      throw new LedgerError(entries.length + 1, `expected seq ${entries.length + 1}`);
    }
    if (entry.prev_hash !== previous) {
      throw new LedgerError(seq, "prev_hash does not link");
    }
    if (typeof entry.hash !== "string" || entry.hash.length !== 64) {
      throw new LedgerError(seq, "bad hash");
    }
    let computed;
    try {
      computed = ledgerHash(entry);
    } catch (error) {
      throw new LedgerError(seq, error.message);
    }
    if (computed !== entry.hash) {
      throw new LedgerError(seq, "hash does not match");
    }
    previous = entry.hash;
    entries.push(entry);
  }
  return entries;
}

export async function verifyLedgerFile(path) {
  return verifyLedgerText(await readFile(path, "utf8"));
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const pathIndex = args.indexOf("--path");
  const path =
    pathIndex >= 0 && args[pathIndex + 1]
      ? args[pathIndex + 1]
      : join(process.cwd(), "content", "ledger", "ledger.jsonl");
  try {
    const entries = await verifyLedgerFile(path);
    if (json) {
      console.log(JSON.stringify(entries.map(({ seq, hash }) => ({ seq, hash }))));
    } else {
      console.log(`✓ chain intact (${entries.length} entries)`);
    }
  } catch (error) {
    const seq = error instanceof LedgerError ? error.seq : 0;
    console.error(`✗ break at seq ${seq}: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
