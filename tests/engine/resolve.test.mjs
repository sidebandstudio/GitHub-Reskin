import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalize, EFFECT_PARAMETERS } from "../../packages/format/index.js";
import { ISSUE_CODES } from "../../packages/contracts/index.js";
import { ACCESSIBILITY_NOTICE, auditPairs, basePolarityIssue, COLOR_PATHS, contrast, resolveTheme, sha256, TOKEN_KEYS } from "../../packages/engine/index.js";

const TESTS = new URL("../", import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const seed = (name) => json(`${TESTS}fixtures/seeds/${name}.json`);
const [darkSeed, lightSeed, colorblindSeed, tritanopiaSeed] = ["standard-dark", "standard-light", "colorblind-dark", "tritanopia-light"].map(seed);
const themed = (s, extra = {}) => ({ seed: s, policy: "themed", reducedMotion: false, forcedColors: false, ...extra });
const rich = json(`${TESTS}fixtures/schema/valid/choom-circuit.reskin.json`);
const minimal = json(`${TESTS}fixtures/schema/valid/minimal-light.reskin.json`);

const THEMED_KEYS = ["tokens", "semantics", "syntax", "ansi", "graph", "rendererVersion", "sourceHash", "seedId", "seedHash", "base", "policy", "font", "effects", "flavor", "motionAllowed", "repairs", "pairAudit"];

test("a themed resolution has exactly the frozen keys, every color and a passing audit", () => {
  const resolved = resolveTheme(rich, themed(darkSeed));
  assert.deepEqual(Object.keys(resolved).sort(), [...THEMED_KEYS].sort());
  assert.deepEqual(Object.keys(resolved.tokens), TOKEN_KEYS);
  const leaves = [...Object.values(resolved.tokens), ...Object.values(resolved.semantics).flatMap(Object.values), ...Object.values(resolved.syntax), ...Object.values(resolved.ansi), ...resolved.graph];
  assert.equal(leaves.length, 109);
  assert.ok(leaves.every((v) => /^#[0-9a-f]{6}$/.test(v)));
  assert.equal(resolved.rendererVersion, 1);
  assert.equal(resolved.seedId, darkSeed.id);
  assert.equal(resolved.seedHash, darkSeed.sourceHash);
  assert.equal(resolved.sourceHash, sha256(new TextEncoder().encode(canonicalize(rich))));
  assert.equal(resolved.pairAudit.length, 287);
  assert.ok(resolved.pairAudit.every((r) => r.passed && r.ratio >= r.minimum));
  assert.deepEqual(auditPairs(resolved), resolved.pairAudit);
  assert.ok(Object.isFrozen(resolved) && Object.isFrozen(resolved.tokens) && Object.isFrozen(resolved.pairAudit[0]));
});

test("source colors start the derivation as the spec's initial-value table says", () => {
  const resolved = resolveTheme(minimal, themed(lightSeed));
  const t = resolved.tokens;
  assert.equal(t.canvas, minimal.colors.background);
  assert.equal(t.text, minimal.colors.text);
  assert.equal(t.accent, minimal.colors.accent);
  assert.equal(t.inputBackground, t.canvas);
  assert.equal(t.tooltipBackground, t.raised);
  assert.equal(t.counterBackground, t.active);
  assert.equal(t.primaryHoverText, t.primaryText);
  assert.equal(t.primaryBorder, t.controlBorder);
  // Repairs only touch failing pairs; supplied passing values survive.
  const choom = resolveTheme(rich, themed(darkSeed)).tokens;
  for (const key of ["surface", "inset", "mutedText", "link", "primaryBackground", "primaryText"]) assert.equal(choom[key], rich.overrides[key], key);
});

test("effects get every default, flavor and font follow the source", () => {
  const resolved = resolveTheme(rich, themed(darkSeed));
  assert.equal(resolved.font, "rajdhani");
  assert.deepEqual(Object.keys(resolved.effects), ["scanlines", "rail", "echo"]);
  assert.deepEqual(resolved.flavor, rich.flavor);
  const defaults = resolveTheme(json(`${TESTS}fixtures/schema/valid/effect-defaults.reskin.json`), themed(lightSeed));
  for (const id of ["paper", "orbit", "drift"]) assert.deepEqual(defaults.effects[id], Object.fromEntries(Object.entries(EFFECT_PARAMETERS[id]).map(([k, v]) => [k, v.default])));
  assert.equal(defaults.font, "system");
  assert.deepEqual(defaults.flavor, { enabled: false, locale: "en", slots: {} });
  assert.deepEqual(resolveTheme({ ...minimal, flavor: { slots: { "profile.tag": "hi" } } }, themed(lightSeed)).flavor, { enabled: true, locale: "en", slots: { "profile.tag": "hi" } });
  assert.equal(resolveTheme(minimal, themed(lightSeed, { reducedMotion: true })).motionAllowed, false);
  assert.equal(resolveTheme(minimal, themed(lightSeed)).motionAllowed, true);
});

test("native policies and forced colors return the null branch without touching source", () => {
  const before = canonicalize(rich);
  for (const [context, policy] of [
    [{ seed: null, policy: "native-high-contrast", reducedMotion: false, forcedColors: false }, "native-high-contrast"],
    [{ seed: null, policy: "native-unknown", reducedMotion: false, forcedColors: false }, "native-unknown"],
    [themed(darkSeed, { forcedColors: true }), "forced-colors"],
    [{ seed: colorblindSeed, policy: "native-high-contrast", reducedMotion: true, forcedColors: true }, "forced-colors"],
  ]) {
    const resolved = resolveTheme(rich, context);
    assert.deepEqual(resolved, {
      rendererVersion: 1,
      sourceHash: sha256(new TextEncoder().encode(before)),
      seedId: context.seed?.id ?? null,
      seedHash: context.seed?.sourceHash ?? null,
      base: "dark",
      policy,
      tokens: null,
      semantics: null,
      syntax: null,
      ansi: null,
      graph: null,
      font: "system",
      effects: {},
      flavor: { enabled: false, locale: "en", slots: {} },
      motionAllowed: false,
      repairs: [],
      pairAudit: [],
    });
    assert.throws(() => auditPairs(resolved), /themed/);
  }
  assert.equal(canonicalize(rich), before);
});

test("invalid contexts and themes fail before rendering", () => {
  assert.throws(() => resolveTheme(rich, themed(lightSeed)), /base/);
  assert.throws(() => resolveTheme(rich, themed(null)), /needs a seed/);
  assert.throws(() => resolveTheme(rich, themed({ ...darkSeed, highContrast: true })), /high contrast/);
  assert.throws(() => resolveTheme(rich, { ...themed(darkSeed), policy: "dimmed" }), /policy/);
  assert.throws(() => resolveTheme(rich, { seed: darkSeed, policy: "themed" }), /booleans/);
  assert.throws(() => resolveTheme(rich, themed({ ...darkSeed, colors: { ...darkSeed.colors, graph: [] } })), /ModeSeed/);
  assert.throws(() => resolveTheme({ ...rich, css: "x" }, themed(darkSeed)), /valid theme/);
});

test("inputs stay unchanged and resolution is deterministic", () => {
  const theme = structuredClone(rich);
  const s = structuredClone(darkSeed);
  const first = resolveTheme(theme, themed(s));
  assert.deepEqual(theme, rich);
  assert.deepEqual(s, darkSeed);
  assert.ok(!Object.isFrozen(theme) && !Object.isFrozen(s));
  assert.equal(JSON.stringify(resolveTheme(structuredClone(rich), themed(structuredClone(darkSeed)))), JSON.stringify(first));
});

test("render repairs carry their before/after and never claim to be source repairs", () => {
  const invisible = json(`${TESTS}fixtures/schema/repair/text-equals-background.reskin.json`);
  const resolved = resolveTheme(invisible, themed(lightSeed));
  const text = resolved.repairs.find((r) => r.path === "/tokens/text");
  assert.deepEqual([text.persistence, text.before, text.after === resolved.tokens.text], ["render", "#f6f2e8", true]);
  assert.ok(contrast(resolved.tokens.text, resolved.tokens.canvas) >= 4.5);
  assert.ok(resolved.repairs.every((r) => r.persistence === "render" && COLOR_PATHS.includes(r.path) && r.before !== r.after && r.reason));
  assert.ok(resolved.pairAudit.every((r) => r.passed));
});

test("accessibility families suppress supplied status inks, render-only, with the notice", () => {
  const theme = json(`${TESTS}fixtures/roundtrip/accessibility-output.reskin.json`);
  const standard = resolveTheme(theme, themed(darkSeed));
  const colorblind = resolveTheme(theme, themed(colorblindSeed));
  for (const role of ["success", "danger", "warning", "done"]) {
    assert.equal(standard.semantics[role].text, theme.overrides[role], role);
    assert.notEqual(colorblind.semantics[role].text, theme.overrides[role], role);
    const repair = colorblind.repairs.find((r) => r.path === `/semantics/${role}/text`);
    assert.equal(repair.persistence, "render");
    assert.equal(repair.before, theme.overrides[role]);
    assert.ok(repair.reason.startsWith(ACCESSIBILITY_NOTICE));
  }
  // The colorblind seed's own success hue (blue) is used, mixed toward white or black only.
  assert.equal(colorblind.semantics.success.text, colorblindSeed.colors.semantics.success.text);
  assert.notEqual(colorblind.tokens.diffAddedBackground, standard.tokens.diffAddedBackground);
  assert.notEqual(colorblind.semantics.success.text, colorblind.semantics.danger.text);
  // Syntax overrides are not accessibility colors and are kept.
  const syntax = json(`${TESTS}fixtures/roundtrip/syntax-diff.reskin.json`);
  assert.deepEqual(resolveTheme(syntax, themed(tritanopiaSeed)).syntax, resolveTheme(syntax, themed(lightSeed)).syntax);
});

test("adversarial mid-gray, straddling and contradictory themes still pass every pair", () => {
  // The four themes whose base contradicts their colors resolve after the caller switches it.
  const contradictory = [0, 4, 5, 6];
  const cases = [
    { base: "dark", colors: { background: "#777777", text: "#808080", accent: "#7a7a7a" } },
    { base: "light", colors: { background: "#767676", text: "#767676", accent: "#767676" } },
    { base: "dark", colors: { background: "#101418", text: "#f4f6f8", accent: "#101418" }, overrides: { surface: "#ffffff", hover: "#f0f0f0", focus: "#101418", link: "#101418" } },
    { base: "light", colors: { background: "#ffffff", text: "#000000", accent: "#ffffff" }, overrides: { surface: "#000000", inset: "#111111", raised: "#222222", selectionBackground: "#000000", selectionText: "#000000" } },
    { base: "dark", colors: { background: "#ffffff", text: "#ffffff", accent: "#ffff00" } },
    { base: "light", colors: { background: "#000000", text: "#000000", accent: "#000000" } },
    { base: "dark", colors: { background: "#c229db", text: "#94db0b", accent: "#66ec7b" }, overrides: { warning: "#26f5bc", primaryBackground: "#808080", primaryText: "#7f7f7f" } },
    { base: "light", colors: { background: "#faf8f1", text: "#222222", accent: "#406044" }, overrides: { syntax: { comment: "#faf8f1", keyword: "#000000", string: "#ffffff" } } },
  ];
  for (const [i, partial] of cases.entries()) {
    let theme = { schemaVersion: 1, name: `Adversarial ${i}`, ...partial };
    assert.equal(basePolarityIssue(theme)?.code, contradictory.includes(i) ? ISSUE_CODES.basePolarity : undefined, theme.name);
    if (contradictory.includes(i)) theme = { ...theme, base: theme.base === "dark" ? "light" : "dark" };
    for (const s of [darkSeed, lightSeed, colorblindSeed, tritanopiaSeed].filter((x) => x.base === theme.base)) {
      const resolved = resolveTheme(theme, themed(s));
      const failed = resolved.pairAudit.filter((r) => !r.passed);
      assert.deepEqual(failed, [], `${theme.name} on ${s.id}`);
      assert.equal(resolved.tokens.canvas, theme.colors.background, "the root background never moves");
    }
  }
});

test("resolution stays fast for a typical rich theme", () => {
  resolveTheme(rich, themed(darkSeed));
  const times = Array.from({ length: 40 }, () => {
    const start = performance.now();
    resolveTheme(rich, themed(colorblindSeed));
    return performance.now() - start;
  }).sort((a, b) => a - b);
  assert.ok(times[Math.floor(times.length * 0.95)] < 50, `p95 ${times[38]} ms`);
});
