// Draft a weekly roundup from the live APIs. No new data and no prose beyond
// one factual line per section. The owner approves by setting "approved": true.
//
//   npm run roundup:draft -- --week 2026-W46
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRoundup, weekRange } from "./roundup-build.mjs";

const BASE = (process.env.CHRONO_API_URL ?? "http://127.0.0.1:8010").replace(/\/+$/, "");
const args = process.argv.slice(2);
const weekArg = args[args.indexOf("--week") + 1];
if (!weekRange(weekArg)) {
  console.error("usage: npm run roundup:draft -- --week 2026-W46");
  process.exit(1);
}

async function json(path) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

const [atlas, upcoming] = await Promise.all([
  json("/api/v1/regime/macro-history?resolution=weekly&start=2024-01-01"),
  json("/api/v1/events/upcoming?limit_per_theme=100&horizon_days=21"),
]);

const roundup = buildRoundup({ week: weekArg, atlas, upcoming });

const dir = join(process.cwd(), "content", "roundups");
await mkdir(dir, { recursive: true });
const path = join(dir, `${weekArg}.json`);
try {
  const existing = JSON.parse(await readFile(path, "utf8"));
  if (existing?.approved === true) roundup.approved = true;
} catch {
  // New draft.
}
await writeFile(path, `${JSON.stringify(roundup, null, 2)}\n`, "utf8");
console.log(path);
