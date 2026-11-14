// Run the Python approval helper from the frontend package, then regenerate
// public/llms.txt from the newly approved week.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLlms } from "./llms-build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, "..", "..", "backend");

let python = process.env.PYTHON;
if (!python) {
  for (const candidate of [
    join(backend, ".venv", "Scripts", "python.exe"),
    join(backend, ".venv", "bin", "python"),
  ]) {
    if (existsSync(candidate)) {
      python = candidate;
      break;
    }
  }
}
python ??= "python";

const result = spawnSync(
  python,
  ["-m", "astro_finance.ledger", "approve", ...process.argv.slice(2)],
  {
    cwd: backend,
    stdio: "inherit",
    env: {
      ...process.env,
      // The wrapper regenerates llms.txt itself, after the Python step.
      SKIP_LLMS: "1",
      PYTHONPATH: [join(backend, "src"), backend].join(
        process.platform === "win32" ? ";" : ":",
      ),
    },
  },
);
if (result.error) {
  console.error(`roundup approval failed: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

process.chdir(resolve(here, ".."));
const text = await buildLlms();
await writeFile("public/llms.txt", text, "utf8");
console.log("wrote public/llms.txt");
