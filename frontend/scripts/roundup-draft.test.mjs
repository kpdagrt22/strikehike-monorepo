// The Saturday draft gate, end to end: roundup-draft.mjs runs as a child
// process against a local fixture API (never the network) in a temporary
// working directory, exactly as roundup-draft.yml runs it.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "roundup-draft.mjs");
const WEEK = "2026-W48"; // Monday 23 Nov 2026

let latestDate = "2026-11-08";
let server;
let base;

function atlas() {
  return {
    meta: {
      latest_core_index: { date: latestDate, score: 13.18, bucket: "calm_bullish" },
    },
    timeline: [
      { date: "2026-10-25", core_index: 15.76 },
      { date: "2026-11-01", core_index: 14.9 },
      { date: latestDate, core_index: 13.18 },
    ],
  };
}

before(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture");
    let body = null;
    if (url.pathname === "/api/v1/regime/macro-history") body = atlas();
    if (url.pathname === "/api/v1/events/upcoming") body = { themes: {} };
    // A valid sky week: the draft now refuses a response without activity.daily (DATA-guards).
    if (url.pathname === "/api/v1/sky/week") {
      const start = url.searchParams.get("start") ?? "2026-11-23";
      const first = Date.parse(`${start}T00:00:00Z`);
      const daily = Array.from({ length: 7 }, (_, i) => ({
        date: new Date(first + i * 86_400_000).toISOString().slice(0, 10),
        score: 40,
      }));
      body = { moon_phases: [], activity: { min: 40, max: 40, peak_date: null, daily } };
    }
    response.writeHead(body ? 200 : 404, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body ?? { detail: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

// The workflow treats any non-zero exit as a refusal (`if ! npm run roundup:draft`).
// Linux exits 1; Node on Windows can abort with a libuv assertion instead when
// process.exit() runs while fetch keep-alive sockets are open. Both refuse.
function refused(run) {
  assert.notEqual(run.code, 0, run.stdout);
  if (process.platform !== "win32") assert.equal(run.code, 1);
}

async function draft(...extra) {
  const cwd = await mkdtemp(join(tmpdir(), "roundup-draft-"));
  await mkdir(join(cwd, "content", "tested"), { recursive: true });
  const child = spawn(process.execPath, [SCRIPT, "--week", WEEK, ...extra], {
    cwd,
    env: { ...process.env, ROUNDUP_API_URL: base, SKY_API_URL: base },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const code = await new Promise((resolve) => child.on("close", resolve));
  const file = join(cwd, "content", "roundups", `${WEEK}.json`);
  const written = await stat(file).then(() => true, () => false);
  const roundup = written ? JSON.parse(await readFile(file, "utf8")) : null;
  await rm(cwd, { recursive: true, force: true });
  return { code, stdout, stderr, written, roundup };
}

test("a stale Regime reading refuses the draft and writes nothing", async () => {
  latestDate = "2026-11-08"; // 15 days before Monday 23 Nov
  const run = await draft();
  refused(run);
  assert.match(
    run.stderr,
    /refusing stale reading: 2026-11-08 is 15 days before 2026-11-23; pass --allow-stale/,
  );
  assert.equal(run.written, false);
});

test("--allow-stale drafts the stale week, unapproved, with a warning", async () => {
  latestDate = "2026-11-08";
  const run = await draft("--allow-stale");
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.written, true);
  assert.equal(run.roundup.week, WEEK);
  assert.equal(run.roundup.approved, false);
  assert.equal(run.roundup.regime.as_of, "2026-11-08");
  assert.match(run.stdout, /warning: stale reading \(15 days\)/);
});

test("a reading ten days old passes without the flag; eleven does not", async () => {
  latestDate = "2026-11-13"; // 10 days
  const fresh = await draft();
  assert.equal(fresh.code, 0, fresh.stderr);
  assert.equal(fresh.written, true);
  assert.equal(fresh.roundup.approved, false);
  assert.doesNotMatch(fresh.stdout, /warning/);

  latestDate = "2026-11-12"; // 11 days
  const stale = await draft();
  refused(stale);
  assert.match(stale.stderr, /is 11 days before 2026-11-23/);
  assert.equal(stale.written, false);
});
