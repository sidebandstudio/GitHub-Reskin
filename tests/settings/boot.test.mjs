import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_THEME_ID, LOCAL_THEME_ID_PREFIX } from "../../packages/contracts/index.js";
import { resolveTheme } from "../../packages/engine/index.js";
import { bootMismatches, bootRecordProblems, buildBootRecord, defaultSettings, effectivePreferences, RUNNING_VERSIONS, snapshotProblems, usableSnapshot } from "../../packages/settings/index.js";
import { catalog, CHOOM, ROOT, SEEDS, snapshot } from "./helpers.mjs";

const settings = { ...defaultSettings(catalog), revision: 12 };
const record = () => buildBootRecord(settings, { catalog, snapshot });
const current = (overrides = {}) => ({
  settingsRevision: 12,
  catalogHash: catalog.hash,
  selectedSourceHash: catalog.sourceHash(DEFAULT_THEME_ID),
  effectivePreferences: effectivePreferences(settings),
  cssConsent: null,
  policy: "themed",
  base: "dark",
  seedId: SEEDS.dark.id,
  seedHash: SEEDS.dark.sourceHash,
  motionAllowed: true,
  ...overrides,
});
const mutate = (fn) => {
  const value = record();
  fn(value);
  return value;
};

test("a built record validates and is reused when everything matches", () => {
  const value = record();
  assert.deepEqual(bootRecordProblems(value), []);
  assert.deepEqual(Object.keys(value).sort(), ["assetHashes", "catalogHash", "cssConsent", "effectivePreferences", "engineVersion", "expansionVersion", "pairMatrixVersion", "rendererVersion", "sanitizerVersion", "selectedSourceHash", "settingsRevision", "validatedTokenSnapshot"]);
  assert.equal(value.expansionVersion, 1);
  assert.equal(value.sanitizerVersion, 1);
  assert.deepEqual(bootMismatches(value, current()), []);
  assert.equal(usableSnapshot(value, current()), value.validatedTokenSnapshot);
});

test("a snapshot without expansion or sanitizer versions is invalid", () => {
  for (const key of ["expansionVersion", "sanitizerVersion"]) {
    const value = mutate((r) => delete r[key]);
    assert.notDeepEqual(bootRecordProblems(value), []);
    assert.equal(usableSnapshot(value, current()), null);
  }
});

test("any other version, or an unknown or missing field, is invalid", () => {
  for (const key of Object.keys(RUNNING_VERSIONS)) assert.notDeepEqual(bootRecordProblems(mutate((r) => (r[key] += 1))), [], key);
  assert.notDeepEqual(bootRecordProblems(mutate((r) => (r.css = ":root{}"))), []);
  assert.notDeepEqual(bootRecordProblems(mutate((r) => delete r.assetHashes)), []);
  // The Revision 3 shape C1 declared is an old core snapshot, not an expanded cache.
  const old = mutate((r) => {
    delete r.expansionVersion;
    delete r.sanitizerVersion;
    delete r.assetHashes;
    delete r.cssConsent;
  });
  assert.equal(usableSnapshot(old, current()), null);
});

test("partial, extra or malformed snapshot colors are invalid", () => {
  const cases = {
    "missing token": (r) => delete r.validatedTokenSnapshot.tokens.canvas,
    "extra token": (r) => (r.validatedTokenSnapshot.tokens.extra = "#000000"),
    "short hex": (r) => (r.validatedTokenSnapshot.tokens.text = "#fff"),
    "uppercase hex": (r) => (r.validatedTokenSnapshot.tokens.text = r.validatedTokenSnapshot.tokens.text.toUpperCase()),
    "missing semantic field": (r) => delete r.validatedTokenSnapshot.semantics.danger.border,
    "missing syntax role": (r) => delete r.validatedTokenSnapshot.syntax.keyword,
    "missing ansi role": (r) => delete r.validatedTokenSnapshot.ansi.brightWhite,
    "four graph levels": (r) => r.validatedTokenSnapshot.graph.pop(),
    "unknown key": (r) => (r.validatedTokenSnapshot.css = "a{}"),
    "unknown font": (r) => (r.validatedTokenSnapshot.font = "comic-sans"),
    "renderer 2": (r) => (r.validatedTokenSnapshot.rendererVersion = 2),
    "bad seed hash": (r) => (r.validatedTokenSnapshot.seedHash = "x"),
  };
  for (const [name, fn] of Object.entries(cases)) assert.notDeepEqual(bootRecordProblems(mutate(fn)), [], name);
});

test("pair and graph constraints are recomputed, not trusted", () => {
  // Unreadable text with an audit edited to claim it passes.
  const unreadable = mutate((r) => {
    const snap = r.validatedTokenSnapshot;
    snap.tokens.text = snap.tokens.canvas === "#000000" ? "#010101" : snap.tokens.canvas;
  });
  assert.notDeepEqual(bootRecordProblems(unreadable), []);
  const forgedAudit = mutate((r) => (r.validatedTokenSnapshot.pairAudit[0].ratio = 99));
  assert.notDeepEqual(bootRecordProblems(forgedAudit), []);
  const flatGraph = mutate((r) => (r.validatedTokenSnapshot.graph[3] = r.validatedTokenSnapshot.graph[4]));
  assert.notDeepEqual(bootRecordProblems(flatGraph), []);
});

test("effects, flavor and repairs are checked against the registry bounds", () => {
  const cases = {
    "unknown effect": (r) => (r.validatedTokenSnapshot.effects.sparkle = {}),
    "glow too strong": (r) => (r.validatedTokenSnapshot.effects.glow.strength = 1),
    "missing parameter": (r) => delete r.validatedTokenSnapshot.effects.scanlines.spacing,
    "fractional integer": (r) => (r.validatedTokenSnapshot.effects.scanlines.spacing = 4.5),
    "unknown slot": (r) => (r.validatedTokenSnapshot.flavor.slots["header.logo"] = "x"),
    "tag too long": (r) => (r.validatedTokenSnapshot.flavor.slots["profile.tag"] = "x".repeat(25)),
    "bidi control": (r) => (r.validatedTokenSnapshot.flavor.slots["profile.tag"] = "a‮b"),
    "resource text": (r) => (r.validatedTokenSnapshot.flavor.slots["profile.tag"] = "url(x)"),
    "data url": (r) => (r.validatedTokenSnapshot.flavor.slots["profile.tag"] = "data:image/png"),
    "locale": (r) => (r.validatedTokenSnapshot.flavor.locale = "fr"),
    "bad repair": (r) => r.validatedTokenSnapshot.repairs.push({ persistence: "render", path: "/tokens/nope", before: "#000000", after: "#ffffff", reason: "x" }),
  };
  for (const [name, fn] of Object.entries(cases)) assert.notDeepEqual(bootRecordProblems(mutate(fn)), [], name);
});

test("every current-state mismatch discards the snapshot", () => {
  const value = record();
  const changes = {
    settingsRevision: 13,
    catalogHash: "0".repeat(64),
    selectedSourceHash: "1".repeat(64),
    effectivePreferences: { ...effectivePreferences(settings), appearance: "calm", extras: false },
    cssConsent: { hash: "2".repeat(64), sanitizerVersion: 1 },
    base: "light",
    seedId: SEEDS.light.id,
    seedHash: SEEDS.light.sourceHash,
    motionAllowed: false,
  };
  for (const [key, changed] of Object.entries(changes)) {
    assert.deepEqual(bootMismatches(value, current({ [key]: changed })), [key], key);
    assert.equal(usableSnapshot(value, current({ [key]: changed })), null, key);
  }
});

test("native and forced-color policy never use a themed snapshot", () => {
  const value = record();
  for (const policy of ["native-high-contrast", "native-unknown", "forced-colors"]) assert.equal(usableSnapshot(value, current({ policy })), null, policy);
});

test("native branches need their exact null and empty fields", () => {
  const native = JSON.parse(JSON.stringify(resolveTheme(CHOOM, { seed: null, policy: "native-high-contrast", reducedMotion: false, forcedColors: false })));
  assert.deepEqual(snapshotProblems(native), []);
  assert.notDeepEqual(snapshotProblems({ ...native, tokens: {} }), []);
  assert.notDeepEqual(snapshotProblems({ ...native, effects: { glow: { strength: 0.1 } } }), []);
  assert.notDeepEqual(snapshotProblems({ ...native, motionAllowed: true }), []);
  const forced = JSON.parse(JSON.stringify(resolveTheme(CHOOM, { seed: SEEDS.dark, policy: "themed", reducedMotion: false, forcedColors: true })));
  assert.deepEqual(snapshotProblems(forced), []);
});

test("the snapshot sourceHash must equal selectedSourceHash", () => {
  const value = mutate((r) => (r.selectedSourceHash = "3".repeat(64)));
  assert.notDeepEqual(bootRecordProblems(value), []);
});

test("garbage never throws and never paints", () => {
  const proto = JSON.parse('{"__proto__": {"polluted": true}, "settingsRevision": 1}');
  for (const value of [null, undefined, "boot", 1, [], {}, proto, { ...record(), validatedTokenSnapshot: null }, { ...record(), validatedTokenSnapshot: [] }]) {
    assert.equal(usableSnapshot(value, current()), null);
  }
  assert.equal({}.polluted, undefined);
});

test("disabled settings and a failing renderer write no snapshot", () => {
  assert.equal(buildBootRecord({ ...settings, enabled: false }, { catalog, snapshot }), null);
  assert.equal(buildBootRecord(settings, { catalog, snapshot: () => { throw new Error("x"); } }), null);
  assert.equal(buildBootRecord(settings, { catalog }), null);
  // A renderer that returns something invalid is not written either.
  assert.equal(buildBootRecord(settings, { catalog, snapshot: (t) => ({ ...snapshot(t), font: "nope" }) }), null);
});

test("snapshot validation fits inside the startup gate", () => {
  const value = record();
  const start = performance.now();
  for (let i = 0; i < 20; i++) usableSnapshot(value, current());
  const each = (performance.now() - start) / 20;
  assert.ok(each < 10, `validation took ${each.toFixed(2)} ms`);
});

test("the package's boot.css gate is finite, bounded and bypassed by forced colors", () => {
  const css = readFileSync(`${ROOT}extension/content/lifecycle/boot.css`, "utf8");
  assert.match(css, /@media not \(forced-colors: active\)/);
  assert.match(css, /html:not\(\[data-reskin-boot\]\)/);
  assert.match(css, /animation: reskin-boot-gate 120ms step-end 0s 1 normal none running !important;/);
  // Both keyframes hold the same values under step-end, so opacity is a hold, never a fade.
  assert.match(css, /from,\s*to \{\s*visibility: hidden;\s*opacity: 0;\s*\}/);
  assert.equal(/infinite|forwards|both|transition|url\(|@import|display/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), false);
  assert.ok(Buffer.byteLength(css) < 1024);
});

test("a theme's images are recorded by hash only; the snapshot carries no image data", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const image = { image: { data: PNG, width: 1, height: 1 } };
  const document = { ...CHOOM, name: "Pictured", backgrounds: { profileBanner: { layers: [image] }, header: { color: "#070710", layers: [image] } } };
  const id = `${LOCAL_THEME_ID_PREFIX}00000000-0000-4000-8000-000000000001`;
  const local = { ...settings, selectedThemeId: id, customThemes: [{ id, document }] };
  const value = buildBootRecord(local, { catalog, snapshot });
  assert.ok(value, "the record builds");
  assert.equal(value.assetHashes.length, 1);
  assert.match(value.assetHashes[0], /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(value), /data:image|base64/);
  assert.deepEqual(record().assetHashes, []);
});
