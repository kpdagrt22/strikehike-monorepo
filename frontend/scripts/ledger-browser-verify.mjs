// Runs the browser's canonical twin under Node's webcrypto.
// Usage: node --experimental-strip-types frontend/scripts/ledger-browser-verify.mjs --path FILE
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ledgerHash } from "../src/lib/ledger/canonical.ts";

const ZERO_HASH = "0".repeat(64);

function pathArg() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--path");
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fileURLToPath(new URL("../content/ledger/ledger.jsonl", import.meta.url));
}

async function main() {
  const text = await readFile(pathArg(), "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  let previous = ZERO_HASH;
  for (let index = 0; index < lines.length; index += 1) {
    const entry = JSON.parse(lines[index]);
    const seq = index + 1;
    if (entry.seq !== seq) throw new Error(`seq ${seq}: expected ${seq}`);
    if (entry.prev_hash !== previous) {
      throw new Error(`seq ${seq}: prev_hash does not link`);
    }
    if (typeof entry.hash !== "string" || entry.hash.length !== 64) {
      throw new Error(`seq ${seq}: bad hash`);
    }
    let computed;
    try {
      computed = await ledgerHash(entry);
    } catch (error) {
      throw new Error(`seq ${seq}: ${error.message}`);
    }
    if (computed !== entry.hash) {
      throw new Error(`seq ${seq}: hash does not match`);
    }
    previous = entry.hash;
  }
  console.log(`browser twin ok: ${lines.length} entries`);
}

main().catch((error) => {
  console.error(`browser twin failed: ${error.message}`);
  process.exit(1);
});
