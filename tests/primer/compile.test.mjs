import assert from "node:assert/strict";
import test from "node:test";
import { parseStylesheet } from "../../packages/primer/css.js";
import { colorAt, compileGitHub, emittedColors, MODE_INDEX, modeSelectors, selectMode } from "../../packages/primer/index.js";
import { EXTRAS_OFF, nativeResolved, PREFS, readJson, resolvedFromSeed } from "./helpers.mjs";

const mappings = readJson("packages/primer/mappings.json");
const plan = (light, dark, base, systemDark = false) => selectMode({ colorMode: "auto", lightTheme: light, darkTheme: dark, systemDark }, base, MODE_INDEX);
const themed = (seedMode) => {
  const p = { seedMode, policy: "themed" };
  return [resolvedFromSeed(MODE_INDEX.modes[seedMode]), p];
};

// The innermost rules of a compiled stylesheet: [selectors, declarations, media path].
function rules(css) {
  const out = [];
  const walk = (list, media) => {
    for (const r of list) {
      if (r.type === "rule") out.push({ selectors: r.selectors, declarations: r.declarations, media });
      else walk(r.rules ?? [], [...media, r.prelude]);
    }
  };
  walk(parseStylesheet(css), []);
  return out;
}

test("native, forced-color and disabled resolutions emit no theme overrides at all", () => {
  for (const policy of ["native-high-contrast", "native-unknown", "forced-colors"]) {
    const out = compileGitHub(nativeResolved(policy), { seedMode: null, policy: policy === "forced-colors" ? "themed" : policy }, PREFS);
    assert.equal(out.css, "", policy);
    assert.deepEqual(out.ownedNodePlan, []);
  }
  const [resolved, p] = themed("dark");
  assert.equal(compileGitHub(resolved, p, { ...PREFS, enabled: false }).css, "");
  assert.equal(compileGitHub(resolved, plan("light", "dark_high_contrast", "dark", true), PREFS).css, "");
});

test("themed output writes every mapped variable from its resolved role, after the family seed's baseline", () => {
  for (const seedMode of Object.keys(MODE_INDEX.nativeCss)) {
    const [resolved, p] = themed(seedMode);
    const { css, warnings } = compileGitHub(resolved, p, PREFS);
    const list = rules(css);
    const main = list.filter((r) => r.declarations.some((d) => d.name === "--bgColor-default"));
    assert.equal(main.length, 2, `${seedMode}: one rule per color-scheme branch`);
    for (const rule of main) {
      assert.deepEqual(rule.media, ["not all and (forced-colors: active)", rule.media[1]]);
      const values = new Map(rule.declarations.map((d) => [d.name, d]));
      for (const d of rule.declarations) assert.equal(d.important, true, `${d.name} is !important`);
      const expected = emittedColors(resolved, mappings.emit, []);
      for (const [name, value] of expected) assert.equal(values.get(name).value, value, `${seedMode} ${name}`);
      // Baseline declarations come first, so mapped roles win where both exist.
      const baseline = MODE_INDEX.nativeCss[seedMode].split(";").map((d) => d.slice(0, d.indexOf(":")));
      assert.ok(baseline.length > 400);
      for (const name of baseline) assert.ok(values.has(name), `${seedMode} baseline ${name}`);
      assert.equal(values.get("color-scheme").value, MODE_INDEX.modes[seedMode].base);
    }
    assert.deepEqual(warnings.filter((w) => w.code !== "primer.readable-fallback"), []);
  }
});

test("theme scope covers exactly the plan's modes; high-contrast and other families never match", () => {
  const [resolved, p] = themed("dark");
  const { css } = compileGitHub(resolved, p, PREFS);
  const main = rules(css).filter((r) => r.declarations.some((d) => d.name === "--bgColor-default"));
  const [lightBranch, darkBranch] = main;
  assert.deepEqual(lightBranch.media[1], "not all and (prefers-color-scheme: dark)");
  assert.deepEqual(lightBranch.selectors, [
    "[data-color-mode=light][data-light-theme=light]", "[data-color-mode=dark][data-dark-theme=dark]", "[data-color-mode=dark][data-dark-theme=dark_dimmed]",
    "[data-color-mode=auto][data-light-theme=light]", "[data-color-mode=auto][data-light-theme=dark]", "[data-color-mode=auto][data-light-theme=dark_dimmed]",
  ]);
  assert.deepEqual(darkBranch.selectors.slice(3), ["[data-color-mode=auto][data-dark-theme=light]", "[data-color-mode=auto][data-dark-theme=dark]", "[data-color-mode=auto][data-dark-theme=dark_dimmed]"]);
  // No blanket rule on every theme attribute and no substring matching.
  assert.doesNotMatch(css, /\[data-(?:light|dark)-theme\]\s*\{|:root\s*[,{]|\*=|\^=|\$=/);
  for (const sel of modeSelectors().filter((s) => s.policy !== "themed" || !["light", "dark", "dark_dimmed"].includes(s.mode))) {
    for (const rule of main) assert.ok(!rule.selectors.includes(sel.selector), `${sel.selector} is not themed by the standard plan`);
  }
});

test("non-inherited rules stay out of islands of any other mode", () => {
  const [resolved, p] = themed("light");
  const { css } = compileGitHub(resolved, p, PREFS);
  const blob = rules(css).filter((r) => r.selectors.some((s) => s.includes(".js-highlight-blob")));
  assert.equal(blob.length, 2);
  for (const r of blob) assert.match(r.selectors[0], /^:is\(.+\) \.js-highlight-blob:not\(:is\(:is\(.+\):not\(.+\)\) \.js-highlight-blob\)$/);
  const graph4 = colorAt(resolved, "/graph/4");
  assert.equal(blob[0].declarations.find((d) => d.name === "fill").value, graph4);
});

test("the compiler interpolates only validated colors, never metadata, flavor or URLs", () => {
  const [resolved, p] = themed("dark");
  const { css } = compileGitHub(resolved, p, PREFS);
  assert.doesNotMatch(css, /<|script|alert|url\(|@import|https?:|expression\(/i);
  const hostile = resolvedFromSeed(MODE_INDEX.modes.dark, { "/tokens/canvas": "#000;}*{x:y" });
  assert.throws(() => compileGitHub(hostile, p, PREFS), /lowercase #rrggbb/);
  const upper = resolvedFromSeed(MODE_INDEX.modes.dark, { "/tokens/text": "#FFFFFF" });
  assert.throws(() => compileGitHub(upper, p, PREFS), /lowercase #rrggbb/);
  const badIndex = { ...MODE_INDEX, nativeCss: { ...MODE_INDEX.nativeCss, dark: "--x:red}body{display:none" } };
  assert.throws(() => compileGitHub(resolved, p, PREFS, badIndex), /unsafe declaration/);
});

test("a resolution from another seed or base cannot be compiled under a plan", () => {
  const [resolved] = themed("dark");
  assert.throws(() => compileGitHub(resolved, { seedMode: "dark_colorblind", policy: "themed" }, PREFS), /resolved against dark/);
  assert.throws(() => compileGitHub({ ...resolved, seedHash: "f".repeat(64) }, { seedMode: "dark", policy: "themed" }, PREFS), /resolved against/);
  assert.throws(() => compileGitHub(resolved, { seedMode: "dark_high_contrast", policy: "themed" }, PREFS), /resolved against|cannot theme/);
  assert.throws(() => compileGitHub(resolved, { seedMode: "nope", policy: "themed" }, PREFS), /not in the ModeIndex/);
  assert.throws(() => compileGitHub(resolved, { seedMode: "dark", policy: "themed" }, { enabled: true }), /six booleans/);
});

test("colors stay complete with every extra off, and the fingerprint tracks its inputs", () => {
  const [resolved, p] = themed("dark");
  const on = compileGitHub(resolved, p, PREFS);
  const off = compileGitHub(resolved, p, EXTRAS_OFF);
  assert.equal(off.css, on.css);
  assert.notEqual(off.fingerprint, on.fingerprint);
  assert.equal(compileGitHub(resolved, p, PREFS).fingerprint, on.fingerprint);
  assert.notEqual(compileGitHub({ ...resolved, sourceHash: "1".repeat(64) }, p, PREFS).fingerprint, on.fingerprint);
  assert.match(on.fingerprint, /^[0-9a-f]{16}$/);
});

test("the primary counter falls back to the primary fill when it would not read with the primary ink", () => {
  const seed = MODE_INDEX.modes.dark;
  const resolved = resolvedFromSeed(seed, { "/tokens/primaryText": "#ffffff", "/tokens/primaryBackground": "#1f6feb", "/tokens/primaryCounterBackground": "#f0f0f0" });
  const { css, warnings } = compileGitHub(resolved, { seedMode: "dark", policy: "themed" }, PREFS);
  assert.match(css, /--buttonCounter-primary-bgColor-rest:#1f6feb !important/);
  assert.equal(warnings[0].code, "primer.readable-fallback");
});

test("the Primer Brand footer gets its own mapped variables, scoped by structure", () => {
  const [resolved, p] = themed("dark");
  const { css } = compileGitHub(resolved, p, PREFS);
  const brand = rules(css).filter((r) => r.declarations.some((d) => d.name === "--brand-color-text-default"));
  assert.equal(brand.length, 2);
  for (const r of brand) {
    assert.ok(r.selectors.every((s) => s.includes('footer[role="contentinfo"]')));
    assert.doesNotMatch(r.selectors.join(","), /class/);
    assert.equal(r.declarations.find((d) => d.name === "--brand-color-text-default").value, colorAt(resolved, "/tokens/text"));
  }
});

test("issue labels use GitHub's formula for the theme's base, not the native mode name", () => {
  for (const [seedMode, threshold] of [["dark", ".6"], ["light", ".453"]]) {
    const [resolved, p] = themed(seedMode);
    const labels = rules(compileGitHub(resolved, p, PREFS).css).filter((r) => r.selectors.some((s) => s.includes(".hx_IssueLabel")));
    assert.equal(labels.length, 2, seedMode);
    for (const r of labels) {
      assert.equal(r.declarations.find((d) => d.name === "--lightness-threshold").value, threshold);
      assert.ok(r.declarations.every((d) => d.important));
      assert.match(r.selectors[0], /:not\(:is\(:is\(.+\):not\(.+\)\) \.hx_IssueLabel\)$/);
    }
  }
});
