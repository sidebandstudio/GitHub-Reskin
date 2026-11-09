import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CSS_VARIABLES, EXTENDED_SYNTAX_ROLES } from "../../packages/contracts/index.js";
import { canonicalize, exportTheme, parseImport, sanitizeCss, validateTheme } from "../../packages/format/index.js";
import { ACCESSIBILITY_NOTICE, contrast, cssVariables, repairTheme, resolveTheme } from "../../packages/engine/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const seed = (name) => json(`tests/fixtures/seeds/${name}.json`);
const [dark, light, colorblind, tritanopia] = ["standard-dark", "standard-light", "colorblind-dark", "tritanopia-light"].map(seed);
const themed = (s) => ({ seed: s, policy: "themed", reducedMotion: false, forcedColors: false });
const MINIMAL = { schemaVersion: 1, name: "Probe", base: "dark", colors: { background: "#0a0a17", text: "#e4f3ff", accent: "#fcee0a" } };
const V1 = new Set(json("tests/fixtures/contracts/pairs.json").records.map((r) => r.id));
const sha = (text) => createHash("sha256").update(text).digest("hex");

test("renderer-1 core output is byte-identical to main for every Classic and older fixture", () => {
  const { cases } = json("tests/engine/fixtures/renderer1-core.json");
  assert.equal(cases.length, 60);
  for (const { file, seed: seedId, sha256 } of cases) {
    const theme = json(file);
    if (seedId === "repair") {
      const s = [dark, light].find((x) => x.base === theme.base);
      let got;
      try {
        const rep = repairTheme(theme, s);
        got = sha(canonicalize(rep.theme) + JSON.stringify(rep.repairs));
      } catch (error) {
        got = sha(String(error.code ?? error.message));
      }
      assert.equal(got, sha256, `${file} source repair`);
      continue;
    }
    const s = [dark, light, colorblind, tritanopia].find((x) => x.id === seedId);
    let core;
    try {
      const r = resolveTheme(theme, themed(s));
      core = { tokens: r.tokens, semantics: r.semantics, syntax: r.syntax, ansi: r.ansi, graph: r.graph, font: r.font, effects: r.effects, flavor: r.flavor, repairs: r.repairs.filter((x) => !x.path.startsWith("/appearance/")), pairAudit: r.pairAudit.filter((x) => V1.has(x.id)), sourceHash: r.sourceHash };
    } catch (error) {
      core = { error: error.code ?? error.message };
    }
    assert.equal(sha(JSON.stringify(core)), sha256, `${file} on ${seedId}`);
  }
});

test("a v1 theme resolves with null appearance groups, so GitHub keeps its own shape, type and paints", () => {
  const { appearance, font } = resolveTheme(MINIMAL, themed(dark));
  assert.deepEqual(appearance.paints, { page: null, profileBanner: null, header: null });
  assert.deepEqual(appearance.shape, { corners: null, borders: null, shadows: null, buttons: null, avatar: null });
  assert.equal(appearance.typography, null);
  assert.deepEqual(appearance.graph, { cellStyle: "square", cellRadius: null, glow: null });
  assert.deepEqual(appearance.details, { scrollbarWidth: "auto", labels: null, topics: null });
  assert.equal(appearance.css, null);
  assert.deepEqual([appearance.fonts.heading.id, appearance.fonts.body.id, font], ["system", "system", "system"]);
  assert.deepEqual(Object.keys(appearance.colors.syntax), [...EXTENDED_SYNTAX_ROLES]);
});

test("extended syntax roles default from resolved core roles and pass on every code and diff background", () => {
  const r = resolveTheme(MINIMAL, themed(dark));
  const s = r.appearance.colors.syntax;
  assert.equal(s.operator, r.syntax.keyword);
  assert.equal(s.attribute, r.syntax.type);
  assert.equal(s.markupQuote, r.syntax.comment);
  assert.equal(s.markupLink, r.tokens.link);
  assert.ok(r.pairAudit.filter((p) => p.id.startsWith("syntax.")).every((p) => p.passed));
  assert.equal(r.pairAudit.filter((p) => EXTENDED_SYNTAX_ROLES.some((role) => p.id === `syntax.${role}`)).length, 15 * 6);
});

test("code.syntax wins over overrides.syntax, and repair writes only the winning request", () => {
  const theme = { ...MINIMAL, overrides: { syntax: { keyword: "#0a0a18", operator: "#ff0000" } }, code: { syntax: { keyword: "#101020" } } };
  const r = resolveTheme(theme, themed(dark));
  assert.notEqual(r.syntax.keyword, "#0a0a18");
  const { theme: repaired, repairs } = repairTheme(theme, dark);
  assert.ok(repairs.some((x) => x.path === "/code/syntax/keyword"));
  assert.ok(!repairs.some((x) => x.path === "/overrides/syntax/keyword"));
  assert.equal(repaired.overrides.syntax.keyword, "#0a0a18", "the losing older request is kept as written");
  assert.ok(contrast(repaired.code.syntax.keyword, r.tokens.codeBackground) >= 4.5);
  assert.equal(repairTheme(repaired, dark).repairs.length, 0);
});

test("details.selection wins over the older overrides; header and scrollbar pairs are repaired", () => {
  const theme = { ...MINIMAL, overrides: { selectionBackground: "#ff0000" }, details: { selection: { background: "#202040", text: "#202041" }, headerText: "#070710", scrollbar: { thumb: "#0b0b18", track: "#070710" } }, backgrounds: { header: { color: "#070710" } } };
  const r = resolveTheme(theme, themed(dark));
  assert.equal(r.tokens.selectionBackground, "#202040");
  assert.ok(contrast(r.tokens.selectionText, r.tokens.selectionBackground) >= 4.5);
  assert.ok(contrast(r.appearance.colors.header.text, r.appearance.colors.header.background) >= 4.5);
  assert.ok(contrast(r.appearance.colors.scrollbar.thumb, r.appearance.colors.scrollbar.track) >= 3);
  const { theme: repaired, repairs } = repairTheme(theme, dark);
  for (const path of ["/details/selection/text", "/details/headerText", "/details/scrollbar/thumb"]) assert.ok(repairs.some((x) => x.path === path && x.persistence === "source"), path);
  assert.equal(repaired.overrides.selectionBackground, "#ff0000");
  assert.equal(repaired.details.scrollbar.track, "#070710", "backgrounds are never moved by appearance repair");
});

test("accessibility families keep their own diff hues; supplied code.diff is render-only suppressed", () => {
  const theme = { ...MINIMAL, code: { diff: { addedText: "#ff00ff", removedText: "#00ff00" } } };
  const standard = resolveTheme(theme, themed(dark));
  const accessible = resolveTheme(theme, themed(colorblind));
  assert.equal(standard.tokens.diffAddedText, "#ff00ff");
  assert.notEqual(accessible.tokens.diffAddedText, "#ff00ff");
  assert.ok(accessible.repairs.some((x) => x.path === "/tokens/diffAddedText" && x.reason === `${ACCESSIBILITY_NOTICE}.`));
});

test("cssVariables exposes exactly the audited registry from repaired output", () => {
  const choom = json("tests/fixtures/choom/choom-circuit-faithful.reskin.json");
  const r = resolveTheme(choom, themed(dark));
  const vars = cssVariables(r);
  assert.deepEqual(Object.keys(vars).sort(), Object.keys(CSS_VARIABLES).sort());
  assert.equal(vars["--reskin-accent"], "#fcee0a");
  assert.equal(vars["--reskin-graph-4"], "#00f0ff");
  assert.equal(vars["--reskin-syntax-markup-list"], r.appearance.colors.syntax.markupList);
  assert.match(vars["--reskin-font-heading"], /^Bahnschrift, "DIN Alternate", "Roboto Condensed"/);
  assert.equal(vars["--reskin-radius"], "12px");
  assert.ok(Object.values(vars).every((v) => !/url\(|data:|<|;|\{/.test(v)));
  assert.equal(cssVariables(resolveTheme({ ...MINIMAL, fonts: { heading: "rajdhani" } }, themed(dark)), { headingFamily: "Reskin Rajdhani" })["--reskin-font-heading"].split(",")[0], '"Reskin Rajdhani"');
  assert.throws(() => cssVariables(resolveTheme(choom, { seed: null, policy: "native-unknown", reducedMotion: false, forcedColors: false })), /themed/);
});

test("deferred font families resolve to GitHub's font with a note; the bundled legacy font field is kept", () => {
  const r = resolveTheme({ ...MINIMAL, fonts: { heading: "orbitron", body: "barlow" } }, themed(dark));
  assert.deepEqual([r.appearance.fonts.heading.id, r.appearance.fonts.heading.requested, r.appearance.fonts.body.id], ["system", "orbitron", "system"]);
  assert.deepEqual(r.appearance.notes.map((n) => n.path), ["/fonts/heading", "/fonts/body"]);
  assert.equal(r.font, "system");
  const accent = resolveTheme({ ...MINIMAL, fonts: { accent: "bungee", heading: "rajdhani" } }, themed(dark));
  assert.deepEqual([accent.font, accent.appearance.fonts.heading.id], ["rajdhani", "rajdhani"]);
  const native = resolveTheme({ ...MINIMAL, fonts: { heading: "roboto-condensed" } }, themed(dark));
  assert.deepEqual([native.font, native.appearance.fonts.heading.source], ["system", "native-stack"]);
});

test("images resolve to the hash of their decoded bytes and a pointer, never base64", () => {
  const theme = json("tests/fixtures/schema/valid/embedded-images.reskin.json");
  const r = resolveTheme(theme, themed(theme.base === "dark" ? dark : light));
  const layers = ["page", "profileBanner", "header"].flatMap((t) => r.appearance.paints[t]?.layers ?? []).filter((l) => l.kind === "image");
  assert.ok(layers.length >= 3);
  for (const layer of layers) {
    assert.match(layer.asset, /^[0-9a-f]{64}$/);
    assert.match(layer.source, /^\/backgrounds\/\w+\/layers\/\d+\/image\/data$/);
  }
  assert.doesNotMatch(JSON.stringify(r), /base64|data:image/);
});

test("the faithful Choom document: parse, validate, resolve, repair, sanitize, export, re-import, fixed point", () => {
  const text = readFileSync(`${ROOT}tests/fixtures/choom/choom-circuit-faithful.reskin.json`, "utf8");
  const imported = parseImport(text, "file");
  assert.ok(imported.ok, JSON.stringify(imported.issues));
  assert.ok(validateTheme(imported.normalized).ok);
  const sanitized = sanitizeCss(imported.normalized.css);
  assert.ok(sanitized.ok);
  assert.equal(sanitized.value.css, imported.normalized.css, "import stores the canonical sanitized CSS");

  const { theme: repaired, repairs } = repairTheme(imported.normalized, dark);
  // The neon syntax module is repaired only where a diff word background needs it; the owner's
  // palette, cyan ramp, header, selection and scrollbar pass unchanged.
  assert.deepEqual(repairs.map((r) => r.path), ["/code/syntax/comment", "/code/syntax/keyword"]);
  for (const [path, value] of [["colors", { background: "#0a0a17", text: "#e4f3ff", accent: "#fcee0a", contribution: "#00f0ff" }], ["details", imported.normalized.details]]) assert.deepEqual(repaired[path], value);
  assert.deepEqual(repaired.contributions.levels, ["#11112a", "#007885", "#009dab", "#00c5d4", "#00f0ff"]);

  for (const s of [dark, colorblind]) {
    const r = resolveTheme(repaired, themed(s));
    assert.deepEqual(r.pairAudit.filter((p) => !p.passed), [], s.id);
    assert.equal(r.tokens.accent, "#fcee0a");
    assert.equal(r.tokens.primaryBackground, "#fcee0a");
    assert.equal(r.tokens.primaryText, "#000000");
    assert.deepEqual(r.graph, repaired.contributions.levels);
    assert.deepEqual(r.appearance.graph, { cellStyle: "glow", cellRadius: 1, glow: { radius: 9, opacity: 0.85, levels: [1, 2, 3, 4], color: null } });
    assert.deepEqual(r.appearance.paints.page.layers.map((l) => [l.kind, l.size]), [["gradientCss", "100% 100vh"], ["gradientCss", "48px 48px"], ["gradientCss", "48px 48px"], ["gradientCss", "auto"]]);
    assert.equal(r.appearance.paints.header.color, "#070710");
    assert.deepEqual([r.appearance.fonts.heading.source, r.appearance.fonts.body.id], ["native-stack", "system"]);
    assert.deepEqual(r.appearance.shape.corners, { style: "bevel", radius: 12 });
    assert.equal(r.appearance.css.hash, sanitized.value.hash);
  }
  assert.throws(() => resolveTheme(repaired, themed(light)), /base/);

  const exported = exportTheme(repaired);
  const again = parseImport(exported.bytes, "file");
  assert.ok(again.ok);
  const second = repairTheme(again.normalized, dark);
  assert.equal(second.repairs.length, 0);
  assert.ok(Buffer.from(exportTheme(second.theme).bytes).equals(Buffer.from(exported.bytes)));
  assert.equal(canonicalize(second.theme), canonicalize(repaired));
});
