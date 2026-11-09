import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { promisify } from "node:util";
import { ANSI_ROLES, DEFERRED_EDITOR_ACTION_TYPES, DIFF_ROLES, EDITOR_ACTION_TYPES, FONT_INVENTORY, ISSUE_CODES, LIMITS, THEME_SYNTAX_ROLES } from "../../packages/contracts/index.js";
import { CAPABILITIES, canonicalize, cssProofs, decodeShare, editorActionIssues, encodeShare, exportTheme, normalizeTheme, parseImport, validateTheme } from "../../packages/format/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const MINIMAL = { schemaVersion: 1, name: "Probe", base: "dark", colors: { background: "#0a0a17", text: "#e4f3ff", accent: "#fcee0a" } };
const choom = json("tests/fixtures/choom/choom-circuit-faithful.reskin.json");

test("every old valid document and the merged Classics stay valid", () => {
  for (const file of ["minimal-light", "effect-defaults", "legacy-rich-v1"]) assert.ok(validateTheme(json(`tests/fixtures/schema/valid/${file}.reskin.json`)).ok, file);
  for (const entry of json("themes/catalog.json")) assert.ok(validateTheme(json(entry.file)).ok, entry.file);
});

test("normalization covers every new color leaf and heading/body font names, with a note each", () => {
  const { theme, notes } = normalizeTheme({
    ...MINIMAL,
    fonts: { heading: "Roboto Condensed", body: "IBM Plex Sans" },
    code: { background: "#FFF", syntax: { operator: "ABCDEF" }, ansi: { red: "#F00" }, diff: { addedText: "#0F0" } },
    details: { headerText: "#EEE", selection: { background: "#111" }, scrollbar: { thumb: "#222" }, labels: { border: "#333" } },
    backgrounds: { page: { color: "#000", layers: [{ gradient: { type: "linear", stops: [{ color: "#AAA", position: 0 }, { color: "#BBB", position: 100 }] } }, { pattern: { kind: "grid", color: "#CCC" } }] } },
    shape: { borders: { color: "#DDD" }, avatar: { frame: { color: "#ABC" } } },
    contributions: { levels: ["#111111", "#222222", "#333333", "#444444", "#555555"], cellBoundary: "#666", glow: { color: "#777" } },
  });
  assert.deepEqual(theme.fonts, { heading: "roboto-condensed", body: "ibm-plex-sans" });
  assert.equal(theme.code.syntax.operator, "#abcdef");
  assert.equal(theme.backgrounds.page.layers[0].gradient.stops[1].color, "#bbbbbb");
  assert.equal(theme.contributions.glow.color, "#777777");
  const paths = notes.map((n) => n.path);
  for (const path of ["/code/background", "/code/syntax/operator", "/code/ansi/red", "/code/diff/addedText", "/details/headerText", "/details/selection/background", "/details/scrollbar/thumb", "/details/labels/border", "/backgrounds/page/color", "/backgrounds/page/layers/0/gradient/stops/0/color", "/backgrounds/page/layers/1/pattern/color", "/shape/borders/color", "/shape/avatar/frame/color", "/contributions/cellBoundary", "/contributions/glow/color", "/fonts/heading", "/fonts/body"]) {
    assert.ok(paths.includes(path), path);
  }
});

test("both representations survive export when a newer field and its older equivalent are supplied", () => {
  const theme = { ...MINIMAL, overrides: { syntax: { keyword: "#ff0000" }, selectionBackground: "#222244" }, code: { syntax: { keyword: "#ffcc00" } }, details: { selection: { background: "#333366" } } };
  const back = parseImport(exportTheme(theme).bytes, "file");
  assert.ok(back.ok);
  assert.deepEqual([back.normalized.overrides.syntax.keyword, back.normalized.code.syntax.keyword], ["#ff0000", "#ffcc00"]);
  assert.deepEqual([back.normalized.overrides.selectionBackground, back.normalized.details.selection.background], ["#222244", "#333366"]);
});

test("gradient stops must not go backwards, and CSS and gradientCss share one byte budget", () => {
  const stops = [{ color: "#000000", position: 50 }, { color: "#ffffff", position: 10 }];
  const backwards = validateTheme({ ...MINIMAL, backgrounds: { page: { layers: [{ gradient: { type: "linear", stops } }] } } });
  assert.deepEqual(backwards.issues.map((i) => [i.code, i.path]), [[ISSUE_CODES.gradientOrder, "/backgrounds/page/layers/0/gradient/stops"]]);
  const rule = `[data-reskin-slot="profile.tag"]{${Array(8).fill("letter-spacing:.1em").join(";")}}`;
  const css = rule.repeat(Math.floor((LIMITS.cssUtf8Bytes - 3000) / rule.length));
  const fits = { ...MINIMAL, css };
  assert.ok(validateTheme(fits).ok);
  const value = `linear-gradient(red,blue)${" ".repeat(LIMITS.cssUtf8Bytes - css.length - "linear-gradient(red,blue)".length + 1)}`;
  assert.ok(value.length <= LIMITS.gradientCssUtf8Bytes);
  const shared = { ...fits, backgrounds: { page: { layers: [{ gradientCss: { value } }] } } };
  assert.deepEqual(validateTheme(shared).issues.map((i) => [i.code, i.path]), [[ISSUE_CODES.outOfBounds, "/css"]]);
  // Multibyte text fits the character cap but not the byte cap.
  assert.equal(validateTheme({ ...MINIMAL, css: `/*${"é".repeat(16400)}*/` }).ok, false);
});

test("CSS and gradientCss are canonical in exports, share codes and hashes, so round trips are fixed points", () => {
  const raw = { ...choom };
  const exported = exportTheme(raw);
  const back = parseImport(exported.bytes, "file");
  assert.ok(back.ok);
  assert.ok(Buffer.from(exportTheme(back.normalized).bytes).equals(Buffer.from(exported.bytes)));
  assert.equal(canonicalize(raw), canonicalize(back.normalized));
  const code = encodeShare(raw);
  const decoded = decodeShare(code);
  assert.ok(decoded.ok);
  assert.equal(encodeShare(decoded.normalized), code);
  assert.match(JSON.parse(new TextDecoder().decode(exported.bytes)).css, /^\.AppHeader,\.Header,\.HeaderMktg\{box-shadow:0 1px 0/);
});

test("old RS1 framing and golden vectors are unchanged", () => {
  const { vectors } = json("tests/format/fixtures/share-vectors.json");
  for (const vector of vectors) assert.equal(encodeShare(vector.theme), vector.code, vector.name);
});

test("every bundled heading and body font imports without a note, and none is deferred", () => {
  assert.deepEqual(FONT_INVENTORY.deferred, []);
  const result = parseImport(JSON.stringify({ ...MINIMAL, fonts: { heading: "orbitron", body: "barlow" } }), "text");
  assert.ok(result.ok);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(result.normalized.fonts, { heading: "orbitron", body: "barlow" });
  assert.ok(!CAPABILITIES.deferred.some((line) => /^fonts/.test(line)));
  const native = parseImport(JSON.stringify({ ...MINIMAL, fonts: { heading: "roboto-condensed" } }), "text");
  assert.deepEqual(native.notes, []);
});

test("deferred editing controls: image upload and the Advanced CSS editor are rejected; the rest are accepted", () => {
  for (const type of EDITOR_ACTION_TYPES) {
    const issues = editorActionIssues({ type });
    if (DEFERRED_EDITOR_ACTION_TYPES.includes(type)) assert.deepEqual(issues.map((i) => i.code), [ISSUE_CODES.deferred], type);
    else assert.deepEqual(issues, [], type);
  }
  assert.equal(editorActionIssues({ type: "remix" })[0].code, ISSUE_CODES.invalidValue);
  assert.equal(CAPABILITIES.increment, 1);
  assert.ok(CAPABILITIES.deferred.length === 3 && CAPABILITIES.admitted.length >= 9);
});

test("the viewer entry fails closed on CSS until build-time proofs for that exact text are registered", async () => {
  const proofs = cssProofs([choom]);
  const script = `
    const viewer = await import(${JSON.stringify(`${ROOT}packages/format/viewer.js`)});
    const engine = await import(${JSON.stringify(`${ROOT}packages/engine/viewer.js`)});
    const theme = ${JSON.stringify(choom)};
    const before = viewer.validateTheme(theme);
    const count = viewer.registerCssProofs(${JSON.stringify(proofs)});
    const after = viewer.validateTheme(theme);
    const changed = viewer.validateTheme({ ...theme, css: theme.css + " " });
    let refused = false;
    try { viewer.registerCssProofs([{ ...${JSON.stringify(proofs[0])}, value: { ...${JSON.stringify(proofs[0].value)}, policyHash: "0".repeat(64) } }]); } catch { refused = true; }
    const seed = ${JSON.stringify(json("tests/fixtures/seeds/standard-dark.json"))};
    const resolved = engine.resolveTheme(theme, { seed, policy: "themed", reducedMotion: false, forcedColors: false });
    console.log(JSON.stringify({ installed: viewer.cssSanitizerInstalled(), before: before.ok ? [] : before.issues.map((i) => i.code + "@" + i.path), count, after: after.ok, changed: changed.ok ? [] : changed.issues.map((i) => i.code), refused, css: resolved.appearance.css.hash, layers: resolved.appearance.paints.page.layers.length }));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script]);
  const out = JSON.parse(stdout);
  assert.equal(out.installed, false);
  assert.ok(out.before.includes(`${ISSUE_CODES.cssUnavailable}@/css`) && out.before.includes(`${ISSUE_CODES.cssUnavailable}@/backgrounds/page/layers/0/gradientCss/value`), out.before.join());
  assert.equal(out.count, 5);
  assert.equal(out.after, true);
  assert.deepEqual(out.changed, [ISSUE_CODES.cssUnavailable]);
  assert.equal(out.refused, true);
  assert.equal(out.css, proofs[0].value.hash);
  assert.equal(out.layers, 4);
});

test("the specification's generated schema boundaries hold", () => {
  const { generatedSchemaCases } = json("tests/fixtures/expansion-cases.json");
  const layer = { pattern: { kind: "grid", color: "#00f0ff" } };
  const stop = (position) => ({ color: "#00f0ff", position });
  const build = {
    "css-max-char": () => ({ ...MINIMAL, css: `/*${"x".repeat(32764)}*/` }),
    "css-over-char": () => ({ ...MINIMAL, css: `/*${"x".repeat(32765)}*/` }),
    "five-wallpaper-layers": () => ({ ...MINIMAL, backgrounds: { page: { layers: Array(5).fill(layer) } } }),
    "nine-gradient-stops": () => ({ ...MINIMAL, backgrounds: { page: { layers: [{ gradient: { type: "linear", stops: Array.from({ length: 9 }, (_, i) => stop(i * 10)) } }] } } }),
    "every-font-role": () => ({ ...MINIMAL, fonts: { accent: "bungee", heading: "oxanium", body: "atkinson-hyperlegible" } }),
    "all-syntax-diff-ansi": () => {
      const color = (keys) => Object.fromEntries(keys.map((k) => [k, "#e4f3ff"]));
      return { ...MINIMAL, code: { background: "#070710", text: "#e4f3ff", syntax: color(THEME_SYNTAX_ROLES), ansi: color(ANSI_ROLES), diff: color(DIFF_ROLES) } };
    },
  };
  assert.deepEqual(generatedSchemaCases.map((c) => c.id).sort(), Object.keys(build).sort());
  for (const testCase of generatedSchemaCases) {
    const theme = build[testCase.id]();
    if (testCase.characters) assert.equal(theme.css.length, testCase.characters, testCase.id);
    assert.equal(validateTheme(theme).ok, testCase.schemaValid, testCase.id);
  }
});
