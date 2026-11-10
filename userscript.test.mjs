// The userscript build. Pages publishes it at its @updateURL. The copy at
// userscript/github-reskin.user.js is frozen: the first userscript checks that path on main for
// updates, and the copy moves those installs to the Pages download. Runtime behavior is tested in
// real browsers against the generated artifact (tests/e2e/userscript) and in tests/userscript.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build as compatibilityBuild } from "./scripts/userscript.mjs";
import { build } from "./userscript/build.mjs";

const script = await build();

test("the frozen bridge copy is a whole userscript that updates from the Pages download", async () => {
  const bridge = (await readFile(new URL("./userscript/github-reskin.user.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(bridge, /^\/\/ @name +GitHub Reskin$/m);
  assert.match(bridge, /^\/\/ @namespace +https:\/\/github\.com\/sidebandstudio\/GitHub-Reskin$/m);
  // Above the first userscript's 1.0.0, so its installs take this copy.
  assert.match(bridge, /^\/\/ @version +1\.1\.0$/m);
  for (const key of ["downloadURL", "updateURL"]) assert.match(bridge, new RegExp(`^// @${key} +https://sidebandstudio\\.github\\.io/GitHub-Reskin/downloads/github-reskin\\.user\\.js$`, "m"));
  assert.match(bridge, /\n\/\/ ==\/UserScript==\n/);
});

test("release.config.json's builder and the compatibility entry build the same script", async () => {
  const config = JSON.parse(await readFile(new URL("./release.config.json", import.meta.url), "utf8"));
  const { build: configured } = await import(new URL(`./${config.userscript.builder}`, import.meta.url).href);
  assert.equal(await configured(), script);
  assert.equal(await compatibilityBuild(), script);
});

test("1.1.0 installs move to this script: same name and namespace, nothing generated from the legacy files", () => {
  assert.match(script, /^\/\/ @name +GitHub Reskin$/m);
  assert.match(script, /^\/\/ @namespace +https:\/\/github\.com\/sidebandstudio\/GitHub-Reskin$/m);
  // The builder's preview fixture quotes the repository README, which names extension/slang.js, so
  // that file is checked for by its code.
  for (const legacy of ["GitHubReskin.card", "POPUP_HTML", "extension/themes.js", "const SWAPS = ["]) assert.ok(!script.includes(legacy), legacy);
});
