import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as engine from "../../packages/engine/index.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("index.d.ts declares exactly the runtime exports of packages/engine", () => {
  const declarations = readFileSync(join(ROOT, "packages/engine/index.d.ts"), "utf8");
  const declared = [...declarations.matchAll(/^export declare (?:function|const) (\w+)\b/gm)].map(([, name]) => name).sort();
  assert.deepEqual(Object.keys(engine).sort(), declared);
});

test("a strict TypeScript consumer without allowJs assigns the module to the frozen interface", async () => {
  const tsc = join(ROOT, "node_modules/typescript/bin/tsc");
  const args = ["--noEmit", "--strict", "--target", "es2022", "--module", "nodenext", "--moduleResolution", "nodenext", "--lib", "es2022,dom"];
  await promisify(execFile)(process.execPath, [tsc, ...args, "tests/engine/module-types.ts"], { cwd: ROOT }).catch((error) => {
    assert.fail(error.stdout || error.message);
  });
});
