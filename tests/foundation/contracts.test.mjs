import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import vm from "node:vm";
import * as contracts from "../../packages/contracts/index.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const declarations = await readFile(join(ROOT, "packages/contracts/index.d.ts"), "utf8");

test("every declared constant exists at runtime and every runtime export is declared", () => {
  const declared = [...declarations.matchAll(/^export declare const (\w+):/gm)].map(([, name]) => name).sort();
  assert.deepEqual(Object.keys(contracts).sort(), declared);
});

test("the declarations type-check strictly and accept the schema's examples", async () => {
  const tsc = join(ROOT, "node_modules/typescript/bin/tsc");
  const args = ["--noEmit", "--strict", "--target", "es2022", "--module", "nodenext", "--moduleResolution", "nodenext", "--lib", "es2022,dom"];
  await promisify(execFile)(process.execPath, [tsc, ...args, "tests/foundation/contracts-usage.ts"], { cwd: ROOT }).catch((error) => {
    assert.fail(error.stdout || error.message);
  });
});

test("contract values are frozen", () => {
  for (const [name, value] of Object.entries(contracts)) {
    if (value && typeof value === "object" && !(value instanceof RegExp)) assert.ok(Object.isFrozen(value), name);
  }
  assert.throws(() => contracts.LIMITS.maxDepth++, TypeError);
  assert.throws(() => contracts.FONT_IDS.push("comic-sans"), TypeError);
});

test("the default theme is Choom Circuit's stable ID, and 1.x Cyberpunk is an alias for it", () => {
  assert.equal(contracts.DEFAULT_THEME_ID, "anime.cyberpunk-edgerunners");
  assert.deepEqual({ ...contracts.LEGACY_THEME_ALIASES }, { cyberpunk: "anime.cyberpunk-edgerunners" });
  assert.equal(contracts.LEGACY_EDITED_COLORS_THEME_ID, "editing-suite");
});

// The legacy names in the contracts must be the ones 1.1.0 actually saved.
test("legacy IDs and keys match what 1.1.0 stores", async () => {
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(await readFile(join(ROOT, "extension/themes.js"), "utf8"), context);
  const ids = Array.from(context.GitHubReskin.THEMES, (theme) => theme.id);
  assert.deepEqual(ids.filter((id) => id !== "cyberpunk"), [...contracts.LEGACY_CLASSIC_THEME_IDS]);
  assert.ok(ids.includes("cyberpunk"));
  assert.deepEqual([...Object.keys(context.GitHubReskin.DEFAULTS)].sort(), [...contracts.LEGACY_STORAGE_KEYS].sort());
  const content = await readFile(join(ROOT, "extension/content.js"), "utf8");
  assert.match(content, new RegExp(`const CACHE = "${contracts.LEGACY_PAGE_CACHE_KEY}"`));
});

test("registries match the theme format's IDs and limits", () => {
  assert.equal(contracts.FONT_IDS.length, 9);
  assert.equal(contracts.FONT_IDS[0], "system");
  assert.equal(contracts.EFFECT_IDS.length, 10);
  assert.equal(contracts.FLAVOR_SLOT_IDS.length, 8);
  assert.equal(contracts.LIMITS.maxEffectsPerTheme, 3);
  assert.equal(contracts.LIMITS.fontTotalWoff2Bytes, 240 * 1024);
  assert.equal(contracts.LIMITS.fontMaxPerFamilyBytes, 30 * 1024);
  assert.deepEqual(
    [contracts.LIMITS.fileUtf8Bytes, contracts.LIMITS.pastedUtf8Bytes, contracts.LIMITS.compressedBytes, contracts.LIMITS.expandedBytes, contracts.LIMITS.maxDepth],
    [65536, 131072, 16384, 65536, 12],
  );
  assert.equal(contracts.BUDGETS.runtimeZipBytes, 1.5 * 1024 * 1024);
  assert.ok(contracts.HEX_COLOR.test("#0a0a17"));
  assert.ok(!contracts.HEX_COLOR.test("#0A0A17"), "normalized colors are lowercase");
  for (const role of contracts.OVERRIDE_COLOR_ROLES) assert.ok(contracts.COLOR_ROLES.includes(role), role);
  assert.ok(new Set(contracts.ISSUE_CODES && Object.values(contracts.ISSUE_CODES)).size === Object.keys(contracts.ISSUE_CODES).length, "issue codes are unique");
});
