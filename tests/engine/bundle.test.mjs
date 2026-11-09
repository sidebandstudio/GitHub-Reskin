// The packages bundle for browsers exactly as the shared build does (esbuild, platform neutral),
// and the bundle behaves like the source.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { BUDGETS } from "../../packages/contracts/index.js";
import { resolveTheme as sourceResolve } from "../../packages/engine/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;

test("format and engine bundle for a neutral platform and match the source output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reskin-bundle-"));
  try {
    const bundles = {};
    for (const name of ["format", "engine"]) {
      const result = await build({ entryPoints: [`packages/${name}/index.js`], absWorkingDir: ROOT, bundle: true, format: "esm", platform: "neutral", target: ["chrome120", "firefox140"], write: false, logLevel: "silent" });
      const text = new TextDecoder().decode(result.outputFiles[0].contents);
      // css-tree's minified code has object keys spelled node:, so only quoted specifiers count.
      assert.doesNotMatch(text, /\brequire\(|\beval\(|new Function|["']node:|Worker\(/, name);
      bundles[name] = join(dir, `${name}.mjs`);
      writeFileSync(bundles[name], text);
    }
    const engine = await import(pathToFileURL(bundles.engine).href);
    const format = await import(pathToFileURL(bundles.format).href);
    const theme = JSON.parse(readFileSync(`${ROOT}tests/fixtures/schema/valid/choom-circuit.reskin.json`, "utf8"));
    const seed = JSON.parse(readFileSync(`${ROOT}tests/fixtures/seeds/colorblind-dark.json`, "utf8"));
    const context = { seed, policy: "themed", reducedMotion: false, forcedColors: false };
    assert.equal(JSON.stringify(engine.resolveTheme(theme, context)), JSON.stringify(sourceResolve(theme, context)));
    assert.ok(format.decodeShare(format.encodeShare(theme)).ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The viewer entry carries no parser; authoring adds css-tree as its own chunk. Sizes are minified
// and gzip level 9, the measurement THEME-EXPANSION.md budgets.
test("viewer and authoring entries stay within their budgets, the parser within its 60 KiB allowance", async () => {
  const measure = async (contents) => {
    const result = await build({ stdin: { contents, resolveDir: ROOT, loader: "js" }, absWorkingDir: ROOT, bundle: true, format: "esm", platform: "neutral", target: ["chrome120", "firefox140"], minify: true, write: false, logLevel: "silent" });
    const bytes = result.outputFiles[0].contents;
    return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, text: new TextDecoder().decode(bytes) };
  };
  const viewer = await measure('export * from "./packages/format/viewer.js"; export * from "./packages/engine/viewer.js";');
  const full = await measure('export * from "./packages/format/index.js"; export * from "./packages/engine/index.js";');
  const parser = await measure('export { parse, walk, generate, lexer, fork, tokenize, ident, clone, List, toPlainObject } from "css-tree/dist/csstree.esm";');
  const sizes = Object.fromEntries(Object.entries({ viewer, full, parser }).map(([name, { raw, gzip }]) => [name, { raw, gzip }]));
  console.log(`bundle sizes ${JSON.stringify(sizes)}; authoring adds ${full.gzip - viewer.gzip} gzip bytes`);
  assert.doesNotMatch(viewer.text, /mdn-data|csstree|Matching for a tree with var/i, "the viewer entry must not bundle the CSS parser");
  assert.ok(parser.gzip <= BUDGETS.cssParserGzipBytes && parser.raw <= BUDGETS.cssParserRawBytes, JSON.stringify(sizes.parser));
  assert.ok(full.gzip <= BUDGETS.contentEngineGzipBytes && full.raw <= BUDGETS.contentEngineRawBytes, JSON.stringify(sizes.full));
  assert.ok(viewer.gzip <= BUDGETS.siteInitialJsGzipBytes, `the viewer entry alone is ${viewer.gzip} gzip bytes`);
});
