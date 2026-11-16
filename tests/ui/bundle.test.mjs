// The extension entry's builder: exactly the generated files, the same bytes twice, C2b's CSS
// sanitizer in every runtime bundle (saved themes can carry Advanced CSS, and the background, the
// content script and every page validate them), css-tree and the catalog only where the page
// does not compile them, and no legacy runtime file in the package.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { strFromU8, unzlibSync } from "fflate";
import { BUDGETS } from "../../packages/contracts/index.js";
import { BUNDLES, build, catalogData, catalogIndex, packedModesModule, readCatalogEntries } from "../../packages/ui/bundle.mjs";
import { catalogFromData, catalogRecord, contentCatalog } from "../../packages/ui/catalog.js";
import { ROOT, extensionFiles, loadEntry, loadReleaseConfig, sha256 } from "../../scripts/build.mjs";

const config = await loadReleaseConfig();
const entry = await loadEntry(config);
const first = await build({ root: ROOT, entry });
const entries = await readCatalogEntries(ROOT);

test("the builder generates exactly the entry's generated files, deterministically", async () => {
  assert.deepEqual(Object.keys(first).sort(), [...entry.generated].sort());
  assert.deepEqual(Object.keys(BUNDLES).sort(), entry.generated.filter((path) => path.endsWith(".js")).sort());
  const second = await build({ root: ROOT, entry });
  for (const path of entry.generated) assert.equal(sha256(second[path]), sha256(first[path]), path);
  // Copied files are byte-identical to their repository paths.
  for (const path of entry.generated.filter((p) => !p.endsWith(".js"))) assert.ok(first[path].equals(await readFile(join(ROOT, path))), path);
});

test("the background and pages install the css-tree sanitizer and carry the bundled catalog and proofs", () => {
  for (const path of ["background.js", "pages/pages.js"]) {
    const text = first[path].toString("utf8");
    // css-tree itself: its lexer error class survives minification, its file paths do not.
    assert.match(text, /SyntaxMatchError/, path);
    assert.match(text, /installCssSanitizer\(\{/, path);
    assert.match(text, /anime\.cyberpunk-edgerunners/, path);
    assert.match(text, /cssProofs/, path);
  }
  assert.match(first["pages/pages.js"].toString(), /mountPicker|rs-card/);
  assert.match(first["pages/pages.js"].toString(), /mountBuilder/);
});

test("the content script carries the catalog's index and the sanitizer without css-tree, which its parser chunk holds", () => {
  const content = first["content.js"].toString("utf8");
  const parser = first["content/css-parser.js"].toString("utf8");
  const choom = entries.find((e) => e.id === "anime.cyberpunk-edgerunners").document;
  assert.match(content, /reskin-style/);
  assert.doesNotMatch(content, /SyntaxMatchError/, "no css-tree in the content script");
  // Every bundled theme's ID and record hash, and no theme's document or CSS.
  const index = catalogIndex(catalogData(entries));
  for (const id of index.ids) assert.ok(content.includes(index.records[id]), id);
  assert.ok(!content.includes(choom.css.slice(0, 60)), "no bundled theme CSS");
  assert.ok(!content.includes(JSON.stringify(choom.name)), "no bundled theme document");
  // The sanitizer is there, waiting for the parser chunk it imports by its packaged path.
  assert.match(content, /css-tree@3\.1\.0/);
  assert.match(content, /content\/css-parser\.js/);
  assert.match(parser, /SyntaxMatchError/);
  assert.match(parser, /export\s*\{/);
  assert.doesNotMatch(parser, /anime\.cyberpunk-edgerunners/);
});

test("the content script's records are the background's, so its index admits exactly what the background stores", () => {
  const data = catalogData(entries);
  const index = catalogIndex(data);
  const full = catalogFromData(structuredClone(data));
  const page = contentCatalog(index);
  for (const id of index.ids) {
    assert.equal(page.document(id), null, id);
    assert.equal(page.pending(id), true, id);
    page.admit(full.record(id));
    assert.deepEqual(page.document(id), data.documents[id], id);
    assert.equal(page.pending(id), false, id);
    assert.equal(page.sourceHash(id), data.hashes[id], id);
  }
  assert.equal(full.record("local:00000000-0000-4000-8000-000000000001"), null);
});

test("the content script's catalog ignores a record whose text is not the build's", () => {
  const data = catalogData(entries);
  const page = contentCatalog(catalogIndex(data));
  const id = "anime.cyberpunk-edgerunners";
  const record = JSON.parse(catalogRecord(data, id));
  record.document.css = ".AppHeader{display:none}";
  for (const text of [JSON.stringify(record), `${catalogRecord(data, id)} `, "{}", "not json", null, undefined, 7]) {
    page.admit(text);
    assert.equal(page.document(id), null, String(text).slice(0, 40));
  }
  assert.equal(page.pending(id), true);
});

test("the packaged extension holds the new runtime and none of the 1.1.0 files", async () => {
  const { files, manifest } = await extensionFiles("chrome", { config, entry });
  for (const legacy of ["popup.html", "popup.js", "popup.css", "themes.js", "slang.js", "github-modes.js"]) assert.equal(files[legacy], undefined, legacy);
  assert.deepEqual(manifest.content_scripts[0].css, ["content/lifecycle/boot.css"]);
  assert.ok(files["content.js"].length > 0 && files["background.js"].length > 0 && files["pages/pages.js"].length > 0);
  for (const page of ["popup", "onboarding", "settings"]) {
    const html = files[`pages/${page}.html`].toString();
    assert.match(html, /<script src="pages\.js" defer><\/script>/, page);
    assert.match(html, new RegExp(`data-page="${page}"`), page);
    assert.doesNotMatch(html, /<script(?![^>]*src=)/, `${page} has no inline script`);
  }
});

test("the background and pages inflate the exact mode data; the content script carries it plain; the package fits its budget", async () => {
  const json = await readFile(join(ROOT, "vendor/primer/modes.json"), "utf8");
  const module = packedModesModule(json);
  assert.ok(module.length < json.length / 8, `${module.length} bytes packed`);
  const context = { strFromU8, unzlibSync, atob, result: null };
  runInNewContext(module.replace(/^import .*\n/, "").replace("export default", "result ="), context);
  assert.equal(JSON.stringify(context.result), JSON.stringify(JSON.parse(json)));
  // A token only the mode data holds, as plain JSON.
  const plain = /accentEmphasis:"#0969da"/;
  assert.match(first["content.js"].toString(), plain);
  for (const path of ["background.js", "pages/pages.js"]) {
    assert.doesNotMatch(first[path].toString(), plain, path);
    assert.match(first[path].toString(), /unzlibSync|JSON\.parse\(strFromU8/, path);
  }
  const { files } = await extensionFiles("chrome", { config, entry });
  const unpacked = Object.values(files).reduce((sum, data) => sum + data.length, 0);
  assert.ok(unpacked <= BUDGETS.unpackedRuntimeBytes, `${unpacked} bytes unpacked`);
});

test("the bundles carry no module path comments, so a rebuild through a linked node_modules writes the same bytes", () => {
  for (const path of Object.keys(BUNDLES)) assert.doesNotMatch(first[path].toString(), /^\/\/ (\.\.\/)*(node_modules|packages|extension)\//m, path);
});
