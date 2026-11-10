// The userscript build. Pages publishes it at its @updateURL. The copy at
// userscript/github-reskin.user.js is frozen: the first userscripts check that path on main for
// updates, and the copy moves those installs to the Pages download. Runtime behavior is tested in
// real browsers against the generated artifact (tests/e2e/userscript) and in tests/userscript.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build as compatibilityBuild } from "./scripts/userscript.mjs";
import { build } from "./userscript/build.mjs";

const script = await build();

// Every version main's userscript/github-reskin.user.js shipped with an @updateURL on that path.
// Managers update only to a higher version, so the bridge must be above all of them.
const RAW_PATH_VERSIONS = ["1.0.0", "1.1.0"];
const above = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  const i = x.findIndex((part, index) => part !== y[index]);
  return i !== -1 && x[i] > y[i];
};

test("the frozen bridge copy is a whole userscript that updates from the Pages download", async () => {
  const bridge = (await readFile(new URL("./userscript/github-reskin.user.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(bridge, /^\/\/ @name +GitHub Reskin$/m);
  assert.match(bridge, /^\/\/ @namespace +https:\/\/github\.com\/sidebandstudio\/GitHub-Reskin$/m);
  const version = bridge.match(/^\/\/ @version +(\d+\.\d+\.\d+)$/m)?.[1];
  for (const shipped of RAW_PATH_VERSIONS) assert.ok(version && above(version, shipped), `bridge ${version} must be above ${shipped}`);
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
