import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { EXTENDED_SYNTAX_ROLES, SYNTAX_ROLES } from "../../packages/contracts/index.js";
import { buildSeed, convertModes, flatten, readModeFile } from "../../packages/primer/convert.js";
import { parseStylesheet } from "../../packages/primer/css.js";
import { generate, readPolicy, readVendor } from "../../packages/primer/generate.mjs";
import { githubModeSelectors, MODE_INDEX } from "../../packages/primer/index.js";
import { ROOT, readJson, readText } from "./helpers.mjs";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const policy = await readPolicy(ROOT);
const vendor = await readVendor(join(ROOT, "vendor/primer/source"));
const mappings = readJson("packages/primer/mappings.json");
const provenance = readJson("vendor/primer/provenance.json");

// Every ColorPath in ColorSet order, from the frozen declarations.
const TOKENS = ["canvas", "surface", "inset", "raised", "hover", "active", "text", "mutedText", "link", "border", "controlBorder", "accent", "accentMuted", "accentEmphasis", "emphasisText", "primaryBackground", "primaryHoverBackground", "primaryPressedBackground", "primaryText", "primaryHoverText", "primaryPressedText", "primaryBorder", "primaryIcon", "primaryCounterBackground", "primaryCounterText", "focusOuter", "focusInner", "selectionBackground", "selectionText", "codeBackground", "codeText", "neutralBackground", "neutralText", "diffAddedBackground", "diffAddedText", "diffRemovedBackground", "diffRemovedText", "diffWordAddedBackground", "diffWordAddedText", "diffWordRemovedBackground", "diffWordRemovedText", "tooltipBackground", "tooltipText", "overlayBackground", "overlayText", "inputBackground", "inputText", "inputPlaceholder", "disabledBackground", "disabledText", "disabledBorder", "counterBackground", "counterText", "labelBackground", "labelText", "labelBorder"];
const SEMANTICS = ["success", "danger", "warning", "done", "sponsor"];
const FIELDS = ["text", "mutedBackground", "emphasisBackground", "onEmphasis", "border"];
const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"];
const COLOR_PATHS = [
  ...TOKENS.map((k) => `/tokens/${k}`),
  ...SEMANTICS.flatMap((r) => FIELDS.map((f) => `/semantics/${r}/${f}`)),
  ...SYNTAX_ROLES.map((r) => `/syntax/${r}`),
  ...ANSI.map((r) => `/ansi/${r}`),
  ...[0, 1, 2, 3, 4].map((n) => `/graph/${n}`),
];
// The resolved appearance colors C2b pairs under matrix version 2, which the expansion maps too.
const APPEARANCE_PATHS = [
  ...EXTENDED_SYNTAX_ROLES.map((r) => `/appearance/colors/syntax/${r}`),
  "/appearance/colors/page/background",
  "/appearance/colors/header/background",
  "/appearance/colors/header/text",
  "/appearance/colors/scrollbar/thumb",
  "/appearance/colors/scrollbar/track",
  ...["labels", "topics"].flatMap((p) => ["background", "text", "border"].map((f) => `/appearance/colors/${p}/${f}`)),
  "/appearance/colors/graph/cellBoundary",
];

test("the frozen inputs match SOURCES.json, carry the MIT license and regenerate byte for byte offline", async () => {
  const sources = readJson("vendor/primer/source/SOURCES.json");
  assert.equal(sources.license.file, "LICENSE.primer-primitives.txt");
  assert.match(readText("vendor/primer/source/LICENSE.primer-primitives.txt"), /The MIT License[\s\S]*GitHub Inc\./);
  for (const [name, entry] of Object.entries(sources.files)) {
    assert.match(entry.url, /^https:\/\/github\.githubassets\.com\/assets\/[a-z_]+-[0-9a-f]+\.css$/, name);
    assert.equal(sha256(readFileSync(join(ROOT, "vendor/primer/source", name))), entry.sha256, name);
  }
  const fresh = await generate(vendor, policy);
  assert.equal(readText("vendor/primer/modes.json"), fresh.modesJson);
  assert.equal(readText("vendor/primer/provenance.json"), fresh.provenanceJson);
  assert.equal(provenance.mappings.sha256, sha256(readText("packages/primer/mappings.json")));
  assert.equal(provenance.policy.sha256, sha256(readText("packages/primer/mode-policy.json")));
  assert.ok(statSync(join(ROOT, "vendor/primer/modes.json")).size <= 800 * 1024, "frozen mode data stays within 800 KiB");
});

test("every discovered mode is reviewed with an explicit policy, and every reviewed mode is frozen", () => {
  const discovered = Object.keys(vendor.files).map((n) => n.slice(0, -4)).sort();
  assert.deepEqual(Object.keys(policy.modes).sort(), discovered);
  assert.deepEqual(Object.keys(MODE_INDEX.modes).sort(), discovered);
  for (const [id, entry] of Object.entries(policy.modes)) {
    assert.equal(entry.policy, entry.highContrast ? "native-high-contrast" : "themed", id);
    assert.equal(entry.base, id.startsWith("light") ? "light" : "dark", id);
    assert.equal(entry.family, id.includes("colorblind") ? "colorblind" : id.includes("tritanopia") ? "tritanopia" : "standard", id);
    assert.equal(entry.highContrast, id.includes("high_contrast"), id);
  }
  // Light, dark, dimmed and every accessibility combination GitHub served on the retrieval date.
  for (const id of ["light", "dark", "dark_dimmed", "light_high_contrast", "dark_high_contrast", "dark_dimmed_high_contrast", "light_colorblind", "dark_colorblind", "light_tritanopia", "dark_tritanopia", "light_colorblind_high_contrast", "dark_colorblind_high_contrast", "light_tritanopia_high_contrast", "dark_tritanopia_high_contrast"]) {
    assert.ok(MODE_INDEX.modes[id], id);
  }
});

test("every production seed has exactly the ColorSet leaves and one origin per leaf", () => {
  for (const [id, seed] of Object.entries(MODE_INDEX.modes)) {
    assert.deepEqual(Object.keys(seed), ["contractVersion", "id", "base", "family", "highContrast", "sourceHash", "colors", "origins"], id);
    assert.equal(seed.contractVersion, 1);
    assert.equal(seed.id, id);
    assert.deepEqual(Object.keys(seed.colors.tokens), TOKENS, id);
    assert.deepEqual(Object.keys(seed.colors.semantics), SEMANTICS, id);
    for (const r of SEMANTICS) assert.deepEqual(Object.keys(seed.colors.semantics[r]), FIELDS, `${id} ${r}`);
    assert.deepEqual(Object.keys(seed.colors.syntax), SYNTAX_ROLES, id);
    assert.deepEqual(Object.keys(seed.colors.ansi), ANSI, id);
    assert.equal(seed.colors.graph.length, 5, id);
    assert.deepEqual(Object.keys(seed.origins), COLOR_PATHS, id);
    const file = `source/${id}.css`;
    const fileHash = vendor.files[`${id}.css`].sha256;
    assert.equal(seed.sourceHash, sha256(JSON.stringify([[file, fileHash]])), `${id} sourceHash`);
    for (const path of COLOR_PATHS) {
      const value = path.split("/").slice(1).reduce((n, k) => n[k], seed.colors);
      assert.match(value, /^#[0-9a-f]{6}$/, `${id} ${path}`);
      const origin = seed.origins[path];
      assert.deepEqual(Object.keys(origin), ["file", "sha256", "variable", "fallback", "compositeOver"]);
      assert.equal(origin.file, file);
      assert.equal(origin.sha256, fileHash);
      assert.equal(origin.variable, mappings.seed[path].variable);
      // No fallbacks anywhere, so accessibility families never borrow standard semantics.
      assert.equal(origin.fallback, false, `${id} ${path}`);
      assert.ok(origin.compositeOver === null || origin.compositeOver === mappings.seed[path].compositeOver, `${id} ${path}`);
    }
  }
});

test("translucent upstream values are flattened over their recorded opaque role", () => {
  const seed = MODE_INDEX.modes.dark;
  const declarations = readModeFile(vendor.files["dark.css"].text, "dark", "dark");
  // --bgColor-accent-muted is #388bfd1a in dark: composited over the canvas.
  assert.equal(declarations.get("--bgColor-accent-muted"), "#388bfd1a");
  assert.equal(seed.origins["/tokens/accentMuted"].compositeOver, "/tokens/canvas");
  assert.equal(seed.colors.tokens.accentMuted, flatten("#388bfd1a", seed.colors.tokens.canvas));
  assert.equal(seed.origins["/tokens/canvas"].compositeOver, null);
  assert.equal(flatten("#ffffff80", "#000000"), "#808080");
});

test("counterparts are unique, keep the family and never drop high contrast", () => {
  const seen = new Set();
  for (const c of MODE_INDEX.counterparts) {
    const key = `${c.nativeMode}|${c.base}`;
    assert.ok(!seen.has(key), `duplicate counterpart ${key}`);
    seen.add(key);
    const native = MODE_INDEX.modes[c.nativeMode];
    const seed = MODE_INDEX.modes[c.seedMode];
    assert.equal(native.highContrast, false, key);
    assert.equal(seed.highContrast, false, key);
    assert.equal(seed.base, c.base, key);
    assert.equal(seed.family, native.family, key);
  }
  const themable = Object.values(MODE_INDEX.modes).filter((m) => !m.highContrast);
  assert.equal(MODE_INDEX.counterparts.length, themable.length * 2);
  for (const m of Object.values(MODE_INDEX.modes).filter((m) => m.highContrast)) assert.ok(!MODE_INDEX.counterparts.some((c) => c.nativeMode === m.id), m.id);
  assert.deepEqual(Object.keys(MODE_INDEX.nativeCss).sort(), [...new Set(MODE_INDEX.counterparts.map((c) => c.seedMode))].sort());
});

test("GitHub's selectors in every frozen file are exactly the ones the adapter mirrors", () => {
  for (const [id, entry] of Object.entries(policy.modes)) {
    const [outer, media] = parseStylesheet(vendor.files[`${id}.css`].text);
    const expected = githubModeSelectors(id, entry.base);
    assert.deepEqual(outer.selectors, expected.always, id);
    assert.deepEqual(media.rules[0].selectors, expected.prefersDark, id);
  }
});

test("the parser and converter refuse malformed, cyclic, unmapped and unreviewed inputs", () => {
  const good = vendor.files["dark.css"].text;
  assert.throws(() => readModeFile(good, "light", "light"), /unexpected selectors/);
  assert.throws(() => readModeFile(`${good}.extra{color:red}`, "dark", "dark"), /expected two top-level rules/);
  assert.throws(() => readModeFile(good.replace("--ansi-cyan:#39c5cf", "--ansi-cyan:#39c5cf !important"), "dark", "dark"), /!important|different values/);
  assert.throws(() => parseStylesheet("a{color:red"), SyntaxError);
  assert.throws(() => parseStylesheet('a{content:"x}'), SyntaxError);
  const entry = policy.modes.dark;
  const decl = (pairs) => new Map(pairs);
  const seedMap = { "/tokens/canvas": { variable: "--a" }, "/tokens/text": { variable: "--b", compositeOver: "/tokens/canvas" } };
  const args = { id: "x", entry, file: "source/x.css", sha256: "0".repeat(64), seedMap, colorPaths: Object.keys(seedMap) };
  assert.throws(() => buildSeed({ ...args, declarations: decl([["--a", "var(--b)"], ["--b", "var(--a)"]]) }), /cyclic reference/);
  assert.throws(() => buildSeed({ ...args, declarations: decl([["--a", "#000"]]) }), /missing variable --b/);
  assert.throws(() => buildSeed({ ...args, declarations: decl([["--a", "#00000080"], ["--b", "#fff"]]) }), /translucent and the mapping names no compositeOver/);
  assert.throws(() => buildSeed({ ...args, declarations: decl([["--a", "0 0 0 1px #000"], ["--b", "#fff"]]) }), /not a color/);
  const files = { ...vendor.files, "dark_sepia.css": vendor.files["dark.css"] };
  assert.throws(() => convertModes({ files, policy, mappings, hash: sha256 }), /Unreviewed modes: dark_sepia/);
  const { "light.css": _light, ...missing } = vendor.files;
  assert.throws(() => convertModes({ files: missing, policy, mappings, hash: sha256 }), /without a frozen stylesheet: light/);
});

test("the mapping covers every seed leaf, emits only variables every mode declares, and records pair coverage", () => {
  assert.deepEqual(Object.keys(mappings.seed), COLOR_PATHS);
  const declared = new Set(provenance.tokenInventory.declared);
  const emitted = mappings.emit.map((m) => m.variable);
  assert.equal(new Set(emitted).size, emitted.length, "no variable is emitted twice");
  // A nested island of another mode declares every one of these itself, so none inherits from a themed ancestor.
  for (const v of emitted) assert.ok(declared.has(v), `${v} is declared by every frozen mode`);
  for (const m of [...mappings.emit, ...mappings.brandFooter, ...mappings.brandPage]) {
    assert.ok(COLOR_PATHS.includes(m.role) || APPEARANCE_PATHS.includes(m.role), `${m.variable} role ${m.role}`);
    if (m.exempt) assert.ok(m.exempt.length > 20, `${m.variable} explains its exemption`);
    else {
      const coverage = mappings.rolePairs[m.role];
      assert.ok(coverage && (coverage.pairs.length || coverage.inheritedPairs.length), `${m.role} has pair coverage`);
    }
  }
  for (const v of [...mappings.brandFooter, ...mappings.brandPage].map((m) => m.variable)) assert.ok(v.startsWith("--brand-") && !declared.has(v), v);
  const all = new Set([...emitted, ...mappings.brandFooter.map((m) => m.variable), ...mappings.brandPage.map((m) => m.variable)]);
  for (const p of mappings.inheritedPairs) {
    assert.ok(all.has(p.foreground), `${p.id} foreground ${p.foreground}`);
    for (const b of p.backgrounds) assert.ok(all.has(b), `${p.id} background ${b}`);
  }
  // Every seasonal graph variable maps to the same ramp level as the default one.
  for (const season of ["default", "halloween", "winter"]) {
    for (let n = season === "default" ? 0 : 1; n < 5; n++) assert.equal(mappings.emit.find((m) => m.variable === `--contribution-${season}-bgColor-${n}`)?.role, `/graph/${n}`);
  }
});

test("the 1.1.0 mode inventory is fully accounted for in the new mapping and baselines", () => {
  // extension/github-modes.js forced 750 standard variables over every mode. Each must now be
  // written from a resolved role, restored from the family seed's baseline, follow one of those
  // through var(), or be identical in every themable mode.
  const text = readText("extension/github-modes.js");
  const legacy = [...new Set([...text.matchAll(/(--[\w-]+):/g)].map((m) => m[1]))];
  assert.ok(legacy.length >= 750, `${legacy.length} legacy variables`);
  const inv = provenance.tokenInventory;
  const handled = new Set([...inv.emitted, ...inv.baseline, ...inv.follows, ...inv.constant]);
  const missing = legacy.filter((v) => !handled.has(v));
  assert.deepEqual(missing, []);
  assert.deepEqual([...handled].sort(), [...inv.declared].sort());
});
