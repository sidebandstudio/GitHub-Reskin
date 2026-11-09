import assert from "node:assert/strict";
import test from "node:test";
import { parseStylesheet } from "../../packages/primer/css.js";
import { colorAt, compileGitHub, coveredModes, emittedColors, islandScope, MODE_INDEX, modeSelectors, selectMode } from "../../packages/primer/index.js";
import { EXTRAS_OFF, nativeResolved, PREFS, readJson, resolvedFromSeed } from "./helpers.mjs";

const mappings = readJson("packages/primer/mappings.json");
const plan = (light, dark, base, systemDark = false) => selectMode({ colorMode: "auto", lightTheme: light, darkTheme: dark, systemDark }, base, MODE_INDEX);
const themed = (seedMode) => {
  const p = { seedMode, policy: "themed" };
  return [resolvedFromSeed(MODE_INDEX.modes[seedMode]), p];
};

// The compounds a grouped island selector such as :is([data-color-mode=dark]:is([data-dark-theme=dark]))
// stands for, in GitHub's own [data-color-mode=x][data-y-theme=z] form.
function compounds(grouped) {
  const out = [];
  for (const [, mode, list] of grouped.matchAll(/\[data-color-mode=(\w+)\]:is\(((?:\[data-\w+-theme=\w+\],?)+)\)/g)) {
    for (const [attr] of list.matchAll(/\[data-\w+-theme=\w+\]/g)) out.push(`[data-color-mode=${mode}]${attr}`);
  }
  return out;
}
const scopeOf = (seedMode, branch) => islandScope(coveredModes(MODE_INDEX, seedMode), Object.keys(MODE_INDEX.modes), (m) => MODE_INDEX.modes[m].base, branch);

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
  for (const [rule, branch] of [[lightBranch, "light"], [darkBranch, "dark"]]) {
    const scope = scopeOf("dark", branch);
    // The root and every nested island of the plan, unless an unsafe island depends on it.
    assert.deepEqual(rule.selectors, [scope.eligible]);
    assert.ok(scope.eligible.startsWith(`${scope.themed}:not(`));
  }
  const themedOf = (rule) => compounds(rule.selectors[0].slice(0, rule.selectors[0].indexOf(":not(")));
  assert.deepEqual(themedOf(lightBranch).sort(), [
    "[data-color-mode=light][data-light-theme=light]", "[data-color-mode=dark][data-dark-theme=dark]", "[data-color-mode=dark][data-dark-theme=dark_dimmed]",
    "[data-color-mode=auto][data-light-theme=light]", "[data-color-mode=auto][data-light-theme=dark]", "[data-color-mode=auto][data-light-theme=dark_dimmed]",
  ].sort());
  assert.deepEqual(themedOf(darkBranch).filter((c) => c.startsWith("[data-color-mode=auto]")).sort(), ["[data-color-mode=auto][data-dark-theme=light]", "[data-color-mode=auto][data-dark-theme=dark]", "[data-color-mode=auto][data-dark-theme=dark_dimmed]"].sort());
  // No blanket rule on every theme attribute and no substring matching.
  assert.doesNotMatch(css, /\[data-(?:light|dark)-theme\]\s*\{|:root\s*[,{]|\*=|\^=|\$=/);
  for (const sel of modeSelectors().filter((s) => s.policy !== "themed" || !["light", "dark", "dark_dimmed"].includes(s.mode))) {
    for (const rule of main) assert.ok(!themedOf(rule).includes(sel.selector), `${sel.selector} is not themed by the standard plan`);
  }
});

// The arguments of every :has() in a selector, outermost first.
function hasArguments(selector) {
  const out = [];
  for (let i = selector.indexOf(":has("); i >= 0; i = selector.indexOf(":has(", i + 1)) {
    let depth = 0;
    let j = i + 4;
    for (; j < selector.length; j++) {
      if (selector[j] === "(") depth++;
      else if (selector[j] === ")" && --depth === 0) break;
    }
    out.push(selector.slice(i + 5, j));
  }
  return out;
}

test("unsafe islands are every island but the frozen mode combinations and the Brand footer's", () => {
  const LOOSE = "[data-color-mode]:not([data-light-theme],[data-dark-theme])";
  const BRAND_LOOSE = `${LOOSE}:is([data-color-mode=light],[data-color-mode=dark])`;
  const WRAPPER = `react-partial[partial-name="marketing-footer"] > div > ${BRAND_LOOSE}`;
  for (const branch of ["light", "dark"]) {
    const { unsafe, eligible, others } = scopeOf("dark", branch);
    const head = ":is([data-color-mode]:is([data-light-theme],[data-dark-theme]):not(";
    assert.ok(unsafe.startsWith(head), branch);
    const known = compounds(unsafe.slice(head.length, unsafe.indexOf(`),${LOOSE}:not(`)));
    const expected = Object.keys(MODE_INDEX.modes).flatMap((m) => {
      const base = MODE_INDEX.modes[m].base;
      return [`[data-color-mode=${base}][data-${base}-theme=${m}]`, `[data-color-mode=auto][data-${branch}-theme=${m}]`];
    });
    assert.deepEqual(known.sort(), expected.sort(), branch);
    // Every island without theme attributes, whatever it holds, except the marketing footer
    // partial's and those inside its footer, while their value is light or dark.
    assert.ok(unsafe.endsWith(`,${LOOSE}:not(${WRAPPER},:is(${WRAPPER} > footer[role="contentinfo"]) ${BRAND_LOOSE}))`), branch);
    // Browsers reject a :has() nested in another; each suppression depth has its own.
    for (const selector of [eligible, unsafe, others]) for (const arg of hasArguments(selector)) assert.doesNotMatch(arg, /:has\(/);
    assert.equal(hasArguments(eligible).length, 4);
    assert.doesNotMatch(unsafe + others, /:has\(/);
    // One compound led by the color-mode attribute, so its :has() is one walk keyed to it.
    assert.ok(others.startsWith("[data-color-mode]:not(") && others.endsWith(")") && !/[ >]/.test(others.slice(0, others.indexOf(":not("))));
  }
});

test("component rules follow a subject's own island, then the nearest island: the switch, and selectors in Gecko without it", () => {
  const [resolved, p] = themed("light");
  const { css } = compileGitHub(resolved, p, PREFS);
  const all = rules(css);
  const graph = all.filter((r) => r.selectors.some((s) => s.includes(".js-highlight-blob")));
  assert.equal(graph.length, 6);
  const branchOf = (r) => (r.media[1].startsWith("not") ? "light" : "dark");
  // A graph that is itself an island takes the theme only through its own themed mode.
  const own = graph.filter((r) => r.media.length === 2);
  assert.equal(own.length, 2);
  for (const r of own) {
    const scope = scopeOf("light", branchOf(r));
    assert.deepEqual(r.selectors, [`:is(.js-highlight-blob,.Progress-item:is(main #js-contribution-activity .Progress[role="img"] > *):not(.markdown-body *))${scope.themed}:not(:has(${scope.unsafe}))`]);
  }
  const gecko = graph.filter((r) => r.media.includes("selector(:-moz-focusring)"));
  assert.equal(gecko.length, 2);
  for (const r of gecko) assert.equal(r.selectors[0], scopeOf("light", branchOf(r)).within(':is(.js-highlight-blob,.Progress-item:is(main #js-contribution-activity .Progress[role="img"] > *):not(.markdown-body *)):not([data-color-mode])'));
  // Every engine with container style queries reads the switch, through any depth.
  const queried = graph.filter((r) => r.media.includes("style(--reskin-on: 1)"));
  assert.equal(queried.length, 2);
  for (const r of queried) {
    assert.deepEqual(r.media.slice(2), ["style(--reskin-on: 1)"]);
    assert.equal(r.selectors.length, 1);
    // The style query reads the parent's switch, so a subject that is an island never matches.
    assert.match(r.selectors[0], /:not\(\[data-color-mode\]\)$/);
    assert.doesNotMatch(r.selectors[0], /data-color-mode=|:has/);
    const values = Object.fromEntries(r.declarations.map((d) => [d.name, d.value]));
    assert.deepEqual(values, { fill: colorAt(resolved, "/graph/4"), stroke: colorAt(resolved, "/graph/4"), "background-color": colorAt(resolved, "/graph/3") });
  }
  // Themed islands raise the switch and carry the selection colors; every other island with
  // theme attributes clears them, at no specificity.
  const main = all.find((r) => r.declarations.some((d) => d.name === "--bgColor-default"));
  const decl = Object.fromEntries(main.declarations.map((d) => [d.name, d.value]));
  assert.equal(decl["--reskin-on"], "1");
  assert.equal(decl["--reskin-selection-text"], colorAt(resolved, "/tokens/selectionText"));
  assert.equal(decl["--reskin-selection-background"], colorAt(resolved, "/tokens/selectionBackground"));
  const reset = all.filter((r) => r.declarations.some((d) => d.name === "--reskin-on" && d.value === "initial"));
  assert.equal(reset.length, 2);
  for (const r of reset) {
    assert.deepEqual(r.selectors, [":where([data-color-mode]:is([data-light-theme],[data-dark-theme]))"]);
    assert.deepEqual(r.declarations.map((d) => [d.name, d.value]), [["--reskin-on", "initial"], ["--reskin-selection-text", "initial"], ["--reskin-selection-background", "initial"]]);
  }
});

test("the activity timeline's commit bars are recolored only through their verified structure", () => {
  const [resolved, p] = themed("dark");
  const { css } = compileGitHub(resolved, p, PREFS);
  const bars = rules(css).filter((r) => r.selectors.some((s) => s.includes(".Progress-item")));
  assert.equal(bars.length, 6);
  for (const r of bars) {
    assert.match(r.selectors[0], /\.Progress-item:is\(main #js-contribution-activity \.Progress\[role="img"\] > \*\):not\(\.markdown-body \*\)/);
    assert.equal(r.declarations.find((d) => d.name === "background-color").value, colorAt(resolved, "/graph/3"));
    assert.equal(r.declarations.find((d) => d.name === "background-color").important, true);
    assert.ok(!r.declarations.some((d) => /^(width|content)$/.test(d.name)));
  }
});

test("selection: Gecko reads each island's colors per element; Chromium sets them once on the body of a page whose islands are all themed", () => {
  const [resolved, p] = themed("dark");
  const all = rules(compileGitHub(resolved, p, PREFS).css);
  const text = colorAt(resolved, "/tokens/selectionText");
  const background = colorAt(resolved, "/tokens/selectionBackground");
  const gecko = all.filter((r) => r.selectors.includes("::selection"));
  assert.deepEqual(gecko.map((r) => [r.media, Object.fromEntries(r.declarations.map((d) => [d.name, d.value]))]), [
    [["not all and (forced-colors: active)", "selector(:-moz-focusring)"], { color: "var(--reskin-selection-text,HighlightText)", "background-color": "var(--reskin-selection-background,Highlight)" }],
  ]);
  const chromium = all.filter((r) => r.selectors.some((s) => s.includes(" > body:not(:has(")));
  assert.equal(chromium.length, 2);
  for (const r of chromium) {
    const branch = r.media[1].startsWith("not") ? "light" : "dark";
    const scope = scopeOf("dark", branch);
    // Gated by selector, not a style query: Chromium does not pass a style-queried highlight
    // rule on to children when the stylesheet changes.
    assert.deepEqual(r.media.slice(2), ["not selector(:-moz-focusring)"]);
    assert.deepEqual(r.selectors, [`:root${scope.themed} > body:not(:has(${scope.others}))::selection`]);
    // Every island but the plan's and the Brand footer's counts, so no native, unknown or
    // suppressed island inherits the body's selection.
    assert.ok(scope.others.startsWith(`[data-color-mode]:not(${scope.themed},react-partial[partial-name="marketing-footer"] > div > `));
    assert.deepEqual(Object.fromEntries(r.declarations.map((d) => [d.name, d.value])), { color: text, "background-color": background });
  }
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
  // Its own mode, the switch and Gecko's selectors, in each color-scheme branch.
  assert.equal(brand.length, 6);
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
    assert.equal(labels.length, 6, seedMode);
    for (const r of labels) {
      assert.equal(r.declarations.find((d) => d.name === "--lightness-threshold").value, threshold);
      assert.ok(r.declarations.every((d) => d.important));
    }
  }
});
