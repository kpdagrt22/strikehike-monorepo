// Draft a weekly roundup from the live APIs. No new data and no prose beyond
// one factual line per section. The owner approves by setting "approved": true.
//
//   npm run roundup:draft -- --week 2026-W47
//
// Regime and dates come from ROUNDUP_API_URL (production by default). The sky
// week comes from SKY_API_URL, which defaults to the same base; set it to a
// local backend while the sky route is not deployed yet.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRoundupV2, staleReading, weekRange } from "./roundup-build.mjs";

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

const [atlas, upcoming, skyWeek] = await Promise.all([
  json(BASE, "/api/v1/regime/macro-history?resolution=weekly&start=2024-01-01"),
  json(BASE, "/api/v1/events/upcoming?limit_per_theme=100&horizon_days=60"),
  json(SKY_BASE, `/api/v1/sky/week?start=${range.start}`),
]);

const claims = {};
const testedDir = join(process.cwd(), "content", "tested");
for (const name of await readdir(testedDir)) {
  if (!name.endsWith(".json")) continue;
  try {
    const claim = JSON.parse(await readFile(join(testedDir, name), "utf8"));
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

const staleDays = roundup.regime
  ? staleReading(roundup.regime.as_of, range.start, 10)
  : null;
if (staleDays != null && !allowStale) {
  console.error(
    `refusing stale reading: ${roundup.regime.as_of} is ${staleDays} days before ${range.start}; pass --allow-stale to draft anyway`,
  );
  process.exit(1);
}

const dir = join(process.cwd(), "content", "roundups");
await mkdir(dir, { recursive: true });
const path = join(dir, `${weekArg}.json`);
try {
  const existing = JSON.parse(await readFile(path, "utf8"));
  if (existing?.schema !== 2) {
    console.error(
      `refusing to overwrite ${path}: version-1 roundups are immutable`,
    );
    process.exit(1);
  }
  if (existing?.approved === true) roundup.approved = true;
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  // New draft.
}
await writeFile(path, `${JSON.stringify(roundup, null, 2)}\n`, "utf8");
console.log(path);
if (staleDays != null) console.log(`warning: stale reading (${staleDays} days)`);
