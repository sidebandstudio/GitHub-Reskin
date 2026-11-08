// The packages bundle for browsers exactly as the shared build does (esbuild, platform neutral),
// and the bundle behaves like the source.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { resolveTheme as sourceResolve } from "../../packages/engine/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;

test("format and engine bundle for a neutral platform and match the source output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reskin-bundle-"));
  try {
    const bundles = {};
    for (const name of ["format", "engine"]) {
      const result = await build({ entryPoints: [`packages/${name}/index.js`], absWorkingDir: ROOT, bundle: true, format: "esm", platform: "neutral", target: ["chrome120", "firefox140"], write: false, logLevel: "silent" });
      const text = new TextDecoder().decode(result.outputFiles[0].contents);
      assert.doesNotMatch(text, /\brequire\(|\beval\(|new Function|node:|Worker\(/, name);
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
