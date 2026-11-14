// Run the Python approval helper from the frontend package.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
      PYTHONPATH: [join(backend, "src"), backend].join(
        process.platform === "win32" ? ";" : ":",
      ),
    },
  },
);
process.exit(result.status ?? 1);
