// Draft a weekly roundup from the live APIs. No new data and no prose beyond
// one factual line per section. The owner approves by setting "approved": true.
//
//   npm run roundup:draft -- --week 2026-W47
//
// Regime and dates come from ROUNDUP_API_URL (production by default). The sky
// week comes from SKY_API_URL, which defaults to the same base; set it to a
// local backend while the sky route is not deployed yet.
//
// Guards (roundup-build.mjs `draftRefusals`): a missing or out-of-range Regime
// reading, a changed API shape, an out-of-range sky activity score or a stale
// reading (unless --allow-stale) refuses the draft. An approved week is a
// published record and is never redrafted. The file is written through a
// temporary file and one rename.
import * as fs from "node:fs/promises";
import { join } from "node:path";
import {
  buildRoundupV2,
  draftRefusals,
  staleReading,
  weekRange,
  writeFileAtomic,
} from "./roundup-build.mjs";

const BASE = (
  process.env.ROUNDUP_API_URL ?? "https://strikehike.com"
).replace(/\/+$/, "");
const SKY_BASE = (process.env.SKY_API_URL ?? BASE).replace(/\/+$/, "");
const args = process.argv.slice(2);
const weekArg = args[args.indexOf("--week") + 1];
const allowStale = args.includes("--allow-stale");
const range = weekRange(weekArg);
if (!range) {
  console.error("usage: npm run roundup:draft -- --week 2026-W47 [--allow-stale]");
  process.exit(1);
}

async function json(base, path) {
  const response = await fetch(`${base}${path}`);
  if (!response.ok) throw new Error(`${base}${path} returned ${response.status}`);
  return response.json();
}

const dir = join(process.cwd(), "content", "roundups");
const path = join(dir, `${weekArg}.json`);
let existing = null;
try {
  existing = JSON.parse(await fs.readFile(path, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  // New draft.
}
if (existing && existing.schema !== 2) {
  console.error(`refusing to overwrite ${path}: version-1 roundups are immutable`);
  process.exit(1);
}
if (existing?.approved === true) {
  // Its sha256 is in the ledger: redrafting would change a published record.
  console.error(`refusing to overwrite ${path}: ${weekArg} is already approved`);
  process.exit(1);
}

const [atlas, upcoming, skyWeek] = await Promise.all([
  json(BASE, "/api/v1/regime/macro-history?resolution=weekly&start=2024-01-01"),
  json(BASE, "/api/v1/events/upcoming?limit_per_theme=100&horizon_days=60"),
  json(SKY_BASE, `/api/v1/sky/week?start=${range.start}`),
]);

const claims = {};
const testedDir = join(process.cwd(), "content", "tested");
for (const name of await fs.readdir(testedDir)) {
  if (!name.endsWith(".json")) continue;
  try {
    const claim = JSON.parse(await fs.readFile(join(testedDir, name), "utf8"));
    if (claim?.id) claims[claim.id] = claim;
  } catch {
    // A missing claim simply removes one possible record link.
  }
}

const roundup = buildRoundupV2({
  week: weekArg,
  atlas,
  upcoming,
  skyWeek,
  claims,
});

const refusals = draftRefusals({ atlas, upcoming, skyWeek, roundup, allowStale });
if (refusals.length) {
  for (const reason of refusals) console.error(`refusing to draft ${weekArg}: ${reason}`);
  process.exit(1);
}

await fs.mkdir(dir, { recursive: true });
await writeFileAtomic(path, `${JSON.stringify(roundup, null, 2)}\n`, fs);
console.log(path);
const staleDays = staleReading(roundup.regime.as_of, range.start, 10);
if (staleDays != null) console.log(`warning: stale reading (${staleDays} days)`);
