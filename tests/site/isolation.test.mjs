// The site's import graph: site/src reaches the shared engine only through its two seams
// (catalog.mjs at build time, engine.mjs in the browser) and only through the packages' real entry
// points. No temporary adapter, handwritten palette mapping or development catalog remains.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT, listFiles } from "./helpers.mjs";

const SPECIFIER = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
// What each site file may import from outside site/: the packages' public modules, C3's slot
// evidence and the release configuration.
const SHARED = [
  "packages/preview/index.js",
  "packages/primer/index.js",
  "packages/appearance/index.js",
  "packages/appearance/registry.js",
  "packages/preview/views.js",
  "packages/format/index.js",
  "packages/format/viewer.js",
  "packages/format/authoring.js",
  "packages/contracts/index.js",
  "extension/content/github/slots.js",
  "release.config.json",
];
const sources = async () => (await listFiles(join(ROOT, "site/src"))).filter((f) => /\.(astro|mjs|js|ts)$/.test(f));
const importsOf = async (file) => {
  const code = await readFile(join(ROOT, "site/src", file), "utf8");
  return [...code.matchAll(SPECIFIER)].map((m) => m[1] || m[2] || m[3]);
};
const resolved = (file, spec) => new URL(spec, `file:///site/src/${file}`).pathname.slice(1);

test("the temporary site/dev adapter and its fixture copies are gone", () => {
  for (const path of ["site/dev", "site/src/fixture", "site/src/lib/fixture.mjs", "site/src/components/Preview.astro", "site/public/site-fixture"]) assert.ok(!existsSync(join(ROOT, path)), `${path} still exists`);
});

test("site files import only site modules and the shared packages' public modules", async () => {
  const offenders = [];
  for (const file of await sources()) {
    for (const spec of await importsOf(file)) {
      if (!spec.startsWith(".")) continue;
      const path = resolved(file, spec);
      if (path.startsWith("site/")) continue;
      if (!SHARED.includes(path)) offenders.push(`${file} imports ${path}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("only the two seams reach the engine, importer and catalog; browser code never imports the build-time seam", async () => {
  const engineSide = ["packages/preview/index.js", "packages/primer/index.js", "packages/format/viewer.js", "packages/format/authoring.js", "packages/appearance/index.js", "extension/content/github/slots.js"];
  const offenders = [];
  for (const file of await sources()) {
    for (const spec of await importsOf(file)) {
      if (!spec.startsWith(".")) continue;
      const path = resolved(file, spec);
      if (engineSide.includes(path) && file !== "engine.mjs") offenders.push(`${file} imports ${path}`);
      if (path === "packages/format/index.js" && file !== "catalog.mjs") offenders.push(`${file} imports the full format entry`);
      if (path === "site/src/catalog.mjs" && file.startsWith("scripts/")) offenders.push(`${file} imports the build-time catalog`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("no handwritten palette or preview adapter remains in the site", async () => {
  const offenders = [];
  for (const file of await sources()) {
    const code = await readFile(join(ROOT, "site/src", file), "utf8");
    if (/--pv-[a-z]|resolvePreview|reskin-dev-adapter|preview-adapter/.test(code)) offenders.push(file);
  }
  for (const file of (await listFiles(join(ROOT, "site/src/styles"))).filter((f) => f.endsWith(".css"))) {
    if (/--pv-/.test(await readFile(join(ROOT, "site/src/styles", file), "utf8"))) offenders.push(`styles/${file}`);
  }
  assert.deepEqual(offenders, []);
});

test("nothing outside the site imports it", async () => {
  const offenders = [];
  for (const dir of ["packages", "extension", "scripts", "userscript"]) {
    for (const file of (await listFiles(join(ROOT, dir)).catch(() => [])).filter((f) => /\.(mjs|js|ts)$/.test(f))) {
      if (/["'][^"']*site\/(src|dev)\//.test(await readFile(join(ROOT, dir, file), "utf8"))) offenders.push(`${dir}/${file}`);
    }
  }
  assert.deepEqual(offenders, []);
});
