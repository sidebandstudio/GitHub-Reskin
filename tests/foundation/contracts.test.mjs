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
const DECLARATION_FILES = ["index.d.ts", "theme-v1.d.ts", "theme-engine.d.ts"];
const sources = Object.fromEntries(
  await Promise.all([...DECLARATION_FILES, "index.js"].map(async (file) => [file, await readFile(join(ROOT, "packages/contracts", file), "utf8")])),
);

test("every declared constant exists at runtime and every runtime export is declared", () => {
  const declared = [...declarations.matchAll(/^export declare const (\w+):/gm)].map(([, name]) => name).sort();
  assert.deepEqual(Object.keys(contracts).sort(), declared);
});

test("the declarations type-check strictly, accept the schema's examples and the frozen engine shapes, and reject the old ones", async () => {
  const tsc = join(ROOT, "node_modules/typescript/bin/tsc");
  const args = ["--noEmit", "--strict", "--target", "es2022", "--module", "nodenext", "--moduleResolution", "nodenext", "--lib", "es2022,dom"];
  await promisify(execFile)(process.execPath, [tsc, ...args, "tests/foundation/contracts-usage.ts"], { cwd: ROOT }).catch((error) => {
    assert.fail(error.stdout || error.message);
  });
});

test("each type has one definition, which index.d.ts re-exports", () => {
  const defined = {};
  for (const file of DECLARATION_FILES) {
    for (const [, name] of sources[file].matchAll(/^export (?:interface|type) (\w+)\b/gm)) (defined[name] ||= []).push(file);
  }
  const duplicates = Object.entries(defined).filter(([, files]) => files.length > 1);
  assert.deepEqual(duplicates, []);
  // Everything theme-v1.d.ts and theme-engine.d.ts define is reachable from index.d.ts.
  const reexported = [...declarations.matchAll(/^export type \{([^}]+)\} from "\.\/theme-(?:v1|engine)\.js";/gm)].flatMap(([, names]) => names.split(",").map((n) => n.trim()).filter(Boolean));
  const frozen = Object.entries(defined).filter(([, [file]]) => file !== "index.d.ts").map(([name]) => name);
  assert.deepEqual([...reexported].sort(), frozen.sort());
  // Types only: the contracts package never promises engine functions at runtime.
  for (const file of DECLARATION_FILES) assert.doesNotMatch(sources[file], /^export declare function/m, file);
});

test("deferred editor and settings features have no contract", () => {
  const deferred = /\b(remixTheme|RemixOptions|lockedColors|redo|canRedo|setGraph|setEffect|favorites|semanticMode|ModeRecord|ResolvedTokens|accentEmphasisText|primaryBackgroundHover)\b/;
  for (const [file, text] of Object.entries(sources)) assert.doesNotMatch(text, deferred, file);
  assert.deepEqual(
    [...contracts.EDITOR_ACTION_TYPES],
    [
      ...["setColor", "setBase", "setFont", "toggleEffect", "setFlavorEnabled", "setFlavorSlot", "undo", "reset", "loadImport"],
      ...["setBackground", "setImage", "setShape", "setTypography", "setCode", "setDetails", "setGraphStyle", "setGraphLevels", "setCss"],
    ],
  );
  // Image upload and the Advanced CSS editor are deferred to the second expansion increment.
  assert.deepEqual([...contracts.DEFERRED_EDITOR_ACTION_TYPES], ["setImage", "setCss"]);
  // Dimmed is a standard-family mode ID, not a family.
  assert.deepEqual([...contracts.MODE_FAMILIES], ["standard", "colorblind", "tritanopia"]);
  assert.deepEqual([...contracts.MODE_POLICIES], ["themed", "native-high-contrast", "native-unknown"]);
  assert.equal(contracts.PAIR_MATRIX_VERSION, 2);
  assert.equal(contracts.EXPANSION_VERSION, 1);
  assert.equal(contracts.SANITIZER_VERSION, 1);
  assert.deepEqual([...contracts.SHARED_BUILD_SCOPES], ["engine", "primer", "preview"]);
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
  // Revision 4: eighteen families at most, 768 KiB of WOFF2, 64 KiB a family, 32 KiB a file.
  assert.equal(contracts.HEADING_FONT_IDS.length, 19);
  assert.equal(contracts.LIMITS.fontTotalWoff2Bytes, 768 * 1024);
  assert.equal(contracts.LIMITS.fontMaxPerFamilyBytes, 64 * 1024);
  assert.equal(contracts.LIMITS.fontMaxPerFileBytes, 32 * 1024);
  assert.deepEqual(
    [contracts.LIMITS.fileUtf8Bytes, contracts.LIMITS.pastedUtf8Bytes, contracts.LIMITS.compressedBytes, contracts.LIMITS.expandedBytes, contracts.LIMITS.maxDepth],
    [512 * 1024, 768 * 1024, 384 * 1024, 512 * 1024, 12],
  );
  assert.equal(contracts.LIMITS.cssUtf8Bytes, 32 * 1024);
  assert.equal(contracts.BUDGETS.runtimeZipBytes, 2.5 * 1024 * 1024);
  assert.equal(contracts.BUDGETS.cssParserGzipBytes, 60 * 1024);
  assert.ok(contracts.HEX_COLOR.test("#0a0a17"));
  assert.ok(!contracts.HEX_COLOR.test("#0A0A17"), "normalized colors are lowercase");
  for (const role of contracts.OVERRIDE_COLOR_ROLES) assert.ok(contracts.COLOR_ROLES.includes(role), role);
  assert.ok(new Set(contracts.ISSUE_CODES && Object.values(contracts.ISSUE_CODES)).size === Object.keys(contracts.ISSUE_CODES).length, "issue codes are unique");
});
