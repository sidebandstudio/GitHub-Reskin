// The temporary adapter stays behind the two seams: only site/src/engine.mjs and
// site/src/catalog.mjs may import site/dev, so phase 2 swaps it by editing those two files.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT, listFiles } from "./helpers.mjs";

const SEAMS = ["engine.mjs", "catalog.mjs"];
const SPECIFIER = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

test("only the engine and catalog seams import site/dev", async () => {
  const src = join(ROOT, "site/src");
  const offenders = [];
  for (const file of (await listFiles(src)).filter((f) => /\.(astro|mjs|js|ts)$/.test(f))) {
    const code = await readFile(join(src, file), "utf8");
    for (const match of code.matchAll(SPECIFIER)) {
      const spec = match[1] || match[2] || match[3];
      if (/(^|\/)dev\//.test(spec) && !SEAMS.includes(file)) offenders.push(`${file} imports ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the seams name what replaces them", async () => {
  for (const seam of SEAMS) {
    const code = await readFile(join(ROOT, "site/src", seam), "utf8");
    assert.match(code, /phase 2/i, `${seam} has no phase 2 note`);
    assert.match(code, /from "\.\.\/dev\//, `${seam} no longer imports site/dev; update this test and the production gate`);
  }
});

test("nothing outside site and its tests imports site/dev", async () => {
  const offenders = [];
  for (const dir of ["packages", "extension", "scripts", "userscript"]) {
    for (const file of (await listFiles(join(ROOT, dir)).catch(() => [])).filter((f) => /\.(mjs|js|ts)$/.test(f))) {
      if ((await readFile(join(ROOT, dir, file), "utf8")).includes("site/dev")) offenders.push(`${dir}/${file}`);
    }
  }
  assert.deepEqual(offenders, []);
});
