// The committed userscript. Installs of 1.1.0 check userscript/github-reskin.user.js on main for
// updates, so it must be exactly what userscript/build.mjs generates; the build target, the
// compatibility entry and the committed copy agree. Runtime behavior is tested in real browsers
// against the generated artifact (tests/e2e/userscript) and in tests/userscript.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build as compatibilityBuild } from "./scripts/userscript.mjs";
import { build } from "./userscript/build.mjs";

const script = await build();

test("the committed userscript is the generated one. Run node userscript/build.mjs after a change", async () => {
  const committed = await readFile(new URL("./userscript/github-reskin.user.js", import.meta.url), "utf8");
  assert.equal(committed.replace(/\r\n/g, "\n"), script);
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
