// The extension entry's builder: exactly the generated files, the same bytes twice, C2b's CSS
// sanitizer in every runtime bundle (saved themes can carry Advanced CSS, and the background, the
// content script and every page validate them) and no legacy runtime file in the package.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { BUNDLES, build } from "../../packages/ui/bundle.mjs";
import { ROOT, extensionFiles, loadEntry, loadReleaseConfig, sha256 } from "../../scripts/build.mjs";

const config = await loadReleaseConfig();
const entry = await loadEntry(config);
const first = await build({ root: ROOT, entry });

test("the builder generates exactly the entry's generated files, deterministically", async () => {
  assert.deepEqual(Object.keys(first).sort(), [...entry.generated].sort());
  assert.deepEqual(Object.keys(BUNDLES).sort(), entry.generated.filter((path) => path.endsWith(".js")).sort());
  const second = await build({ root: ROOT, entry });
  for (const path of entry.generated) assert.equal(sha256(second[path]), sha256(first[path]), path);
  // Copied files are byte-identical to their repository paths.
  for (const path of entry.generated.filter((p) => !p.endsWith(".js"))) assert.ok(first[path].equals(await readFile(join(ROOT, path))), path);
});

test("runtime bundles install the css-tree sanitizer and carry the bundled catalog and proofs", () => {
  for (const path of Object.keys(BUNDLES)) {
    const text = first[path].toString("utf8");
    // css-tree itself: its lexer error class survives minification, its file paths do not.
    assert.match(text, /SyntaxMatchError/, path);
    assert.match(text, /installCssSanitizer\(\{/, path);
    assert.match(text, /anime\.cyberpunk-edgerunners/, path);
    assert.match(text, /cssProofs/, path);
  }
  assert.match(first["content.js"].toString(), /reskin-style/);
  assert.match(first["pages/pages.js"].toString(), /mountPicker|rs-card/);
  assert.match(first["pages/pages.js"].toString(), /mountBuilder/);
});

test("the packaged extension holds the new runtime and none of the 1.1.0 files", async () => {
  const { files, manifest } = await extensionFiles("chrome", { config, entry });
  for (const legacy of ["popup.html", "popup.js", "popup.css", "themes.js", "slang.js", "github-modes.js"]) assert.equal(files[legacy], undefined, legacy);
  assert.ok(!files["content.js"].equals(await readFile(join(ROOT, "extension/content.js"))), "content.js is the new bundle, not the 1.1.0 script");
  assert.deepEqual(manifest.content_scripts[0].css, ["content/lifecycle/boot.css"]);
  assert.ok(files["content.js"].length > 0 && files["background.js"].length > 0 && files["pages/pages.js"].length > 0);
  for (const page of ["popup", "onboarding", "settings"]) {
    const html = files[`pages/${page}.html`].toString();
    assert.match(html, /<script src="pages\.js" defer><\/script>/, page);
    assert.match(html, new RegExp(`data-page="${page}"`), page);
    assert.doesNotMatch(html, /<script(?![^>]*src=)/, `${page} has no inline script`);
  }
});
