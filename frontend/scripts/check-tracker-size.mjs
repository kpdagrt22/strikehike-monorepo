import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import terserModule from "next/dist/compiled/terser/bundle.min.js";

const terser = terserModule.default ?? terserModule;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, "..", "src", "lib", "analytics", "track.ts");
const LIMIT = 2 * 1024;

const source = await readFile(FILE, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    removeComments: true,
  },
}).outputText;
const minified = (
  await terser.minify(compiled, {
    module: true,
    compress: true,
    mangle: true,
  })
).code;
const gzip = gzipSync(Buffer.from(minified), { level: 9 }).length;
console.log(`track.ts: ${gzip} bytes gzip (limit ${LIMIT})`);
if (!minified || gzip > LIMIT) process.exit(1);
