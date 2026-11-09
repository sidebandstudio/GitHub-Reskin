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
import * as sourceFormat from "../../packages/format/index.js";
import { buildSharedFrom } from "../../scripts/build.mjs";

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

// Themes whose CSS and gradientCss the full entries admit, and the review's probes they refuse.
const SLOT = '[data-reskin-slot="profile.tag"]';
const MINIMAL = { schemaVersion: 1, name: "Probe", base: "dark", colors: { background: "#111111", text: "#ffffff", accent: "#ffcc00" } };
const fixture = (name) => JSON.parse(readFileSync(`${ROOT}tests/fixtures/schema/valid/${name}.reskin.json`, "utf8"));
const ADMITTED = [{ ...MINIMAL, css: `${SLOT}{border-color:red}` }, fixture("choom-circuit"), fixture("advanced-css"), fixture("art-additions")];
const PROBES = [
  `${SLOT}{width:calc(clamp(100000px,10px,1px))}`,
  `${SLOT}{transform:translateX(8px) translateX(8px)}`,
  ".AppHeader{color:inherit}",
  `${SLOT}{--theme-x:rgb(garbage);opacity:1}`,
  `${SLOT}{border-color:var(--reskin-accent,999999px)}`,
  `${SLOT}{background-image:linear-gradient(red 80%,blue 20%)}`,
  `${SLOT}{--theme-v0:1px;--theme-v1:max(${Array(8).fill("var(--theme-v0)").join(",")});--theme-v2:max(${Array(8).fill("var(--theme-v1)").join(",")});--theme-v3:max(${Array(8).fill("var(--theme-v2)").join(",")});--theme-v4:max(${Array(8).fill("var(--theme-v3)").join(",")});--theme-v5:max(${Array(8).fill("var(--theme-v4)").join(",")});opacity:1}`,
].map((css) => ({ ...MINIMAL, css }));
const GRADIENT_PROBE = { ...MINIMAL, backgrounds: { page: { layers: [{ gradientCss: { value: "linear-gradient(red,blue)", size: "calc(clamp(100000px,10px,1px))" } }] } } };
const seed = (name) => JSON.parse(readFileSync(`${ROOT}tests/fixtures/seeds/${name}.json`, "utf8"));
const SEEDS = { dark: seed("colorblind-dark"), light: seed("standard-light") };
const contextFor = (theme) => ({ seed: SEEDS[theme.base] ?? SEEDS.dark, policy: "themed", reducedMotion: false, forcedColors: false });
const outcome = (fn) => {
  try {
    return JSON.stringify(fn());
  } catch (error) {
    return `throws ${error.message}`;
  }
};

async function bundleModule(dir, name, contents) {
  const result = await build({ stdin: { contents, resolveDir: ROOT, loader: "js" }, absWorkingDir: ROOT, bundle: true, format: "esm", platform: "neutral", target: ["chrome120", "firefox140"], minify: true, write: false, logLevel: "silent" });
  const path = join(dir, `${name}.mjs`);
  writeFileSync(path, result.outputFiles[0].contents);
  return import(pathToFileURL(path).href);
}

// Every check the source runs, on a bundled API: import, validation and resolution agree on the
// admitted themes and on every probe.
function assertSameChecks(api, label) {
  for (const theme of [...ADMITTED, ...PROBES, GRADIENT_PROBE]) {
    const at = `${label}: ${theme.css ?? "gradientCss"}`;
    if (api.parseImport) assert.equal(outcome(() => api.parseImport(JSON.stringify(theme), "file")), outcome(() => sourceFormat.parseImport(JSON.stringify(theme), "file")), at);
    if (api.validateTheme) assert.equal(outcome(() => api.validateTheme(theme)), outcome(() => sourceFormat.validateTheme(theme)), at);
    if (api.resolveTheme) assert.equal(outcome(() => api.resolveTheme(theme, contextFor(theme))), outcome(() => sourceResolve(theme, contextFor(theme))), at);
  }
  for (const theme of ADMITTED) {
    if (api.validateTheme) assert.ok(api.validateTheme(theme).ok, `${label} admits ${theme.name}`);
    if (api.resolveTheme) assert.ok(api.resolveTheme(theme, contextFor(theme)).appearance, `${label} resolves ${theme.name}`);
  }
  for (const theme of PROBES) if (api.validateTheme) assert.equal(api.validateTheme(theme).ok, false, `${label} refuses ${theme.css}`);
}

test("r1 finding 3: named and namespace imports of each full entry keep the sanitizer once bundled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reskin-entries-"));
  try {
    const entries = {
      formatNamed: 'export { parseImport, validateTheme } from "./packages/format/index.js";',
      engineNamed: 'export { resolveTheme } from "./packages/engine/index.js";',
      formatNamespace: 'export * from "./packages/format/index.js";',
      engineNamespace: 'export * from "./packages/engine/index.js";',
      explicitAuthoring: 'import "./packages/format/authoring.js"; export { parseImport, validateTheme } from "./packages/format/viewer.js"; export { resolveTheme } from "./packages/engine/viewer.js";',
    };
    for (const [name, contents] of Object.entries(entries)) assertSameChecks(await bundleModule(dir, name, contents), name);
    // The viewers alone stay closed: CSS needs the sanitizer or a build-time proof.
    const viewer = await bundleModule(dir, "viewer", 'export { validateTheme, cssSanitizerInstalled } from "./packages/format/viewer.js"; export { resolveTheme } from "./packages/engine/viewer.js";');
    assert.equal(viewer.cssSanitizerInstalled(), false);
    for (const theme of ADMITTED.filter((t) => t.css)) {
      assert.equal(viewer.validateTheme(theme).issues?.[0]?.code, "css-unavailable", theme.name);
      assert.throws(() => viewer.resolveTheme(theme, contextFor(theme)), /css-unavailable/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("r1 finding 3: the built shared engine scope runs the same checks as the source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reskin-shared-"));
  try {
    const built = await buildSharedFrom(ROOT, { outDir: dir, scope: "engine" });
    assert.deepEqual(Object.keys(built.files).sort(), ["contracts.js", "engine.js", "format.js"]);
    for (const name of ["format", "engine"]) {
      const api = await import(pathToFileURL(join(built.dir, `${name}.js`)).href);
      assertSameChecks(api, `shared ${name}.js`);
    }
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
  // What an adapter or site imports by name: the runtime keeps the sanitizer, the preview does not.
  const runtime = await measure('export { resolveTheme, cssVariables } from "./packages/engine/index.js"; export { compileCss, installStyleText } from "./packages/format/index.js";');
  const preview = await measure('export { resolveTheme, cssVariables } from "./packages/engine/viewer.js"; export { compileCss, registerCssProofs, escapeCssForHtml, styleElementHtml, installStyleText } from "./packages/format/viewer.js";');
  const sizes = Object.fromEntries(Object.entries({ viewer, full, parser, runtime, preview }).map(([name, { raw, gzip }]) => [name, { raw, gzip }]));
  console.log(`bundle sizes ${JSON.stringify(sizes)}; authoring adds ${full.gzip - viewer.gzip} gzip bytes`);
  assert.doesNotMatch(viewer.text, /mdn-data|csstree|Matching for a tree with var/i, "the viewer entry must not bundle the CSS parser");
  assert.ok(parser.gzip <= BUDGETS.cssParserGzipBytes && parser.raw <= BUDGETS.cssParserRawBytes, JSON.stringify(sizes.parser));
  assert.ok(full.gzip <= BUDGETS.contentEngineGzipBytes && full.raw <= BUDGETS.contentEngineRawBytes, JSON.stringify(sizes.full));
  assert.ok(viewer.gzip <= BUDGETS.siteInitialJsGzipBytes, `the viewer entry alone is ${viewer.gzip} gzip bytes`);
  assert.match(runtime.text, /Matching for a tree with var/, "a named runtime import keeps the sanitizer");
  assert.ok(runtime.gzip < full.gzip && runtime.raw < full.raw && runtime.raw <= BUDGETS.contentEngineRawBytes, JSON.stringify(sizes.runtime));
  assert.doesNotMatch(preview.text, /mdn-data|csstree|Matching for a tree with var/i, "the preview import must not bundle the CSS parser");
  assert.ok(preview.gzip < viewer.gzip && preview.gzip <= BUDGETS.siteInitialJsGzipBytes, JSON.stringify(sizes.preview));
});
