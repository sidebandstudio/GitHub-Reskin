import assert from "node:assert/strict";
import test from "node:test";
import { CSS_VARIABLES } from "../../packages/contracts/index.js";
import { resolveTheme } from "../../packages/engine/index.js";
import { cssVariables } from "../../packages/engine/variables.js";
import { parseStylesheet } from "../../packages/primer/css.js";
import { colorAt, compileGitHub, contrast, coveredModes, emittedColors, islandScope, MODE_INDEX, modeSelectors, selectMode } from "../../packages/primer/index.js";
import { PROTECTED } from "../../packages/primer/registry.js";
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
// The stylesheet without the registry's fixed protected-UI list, whole or by alternative, whose
// link tests are substring matches on GitHub's own URLs, not on mode attributes or theme input.
const withoutProtected = (css) => PROTECTED.split(",").reduce((text, s) => text.replaceAll(s, ""), css.replaceAll(PROTECTED, ""));
const GRAPH = '.js-highlight-blob,.Progress-item:is(main #js-contribution-activity .Progress[role="img"] > *):not(.markdown-body *)';
const PROTECTED_UI = `${PROTECTED},[data-reskin-protected]`;
const UNPROTECTED = `:not(${PROTECTED_UI},:is(${PROTECTED_UI}) *)`;
// A themed island's rule: the one that raises the switch.
const raises = (r) => r.declarations.some((d) => d.name === "--reskin-on" && d.value === "1");
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
    const main = list.filter(raises);
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
  const main = rules(css).filter(raises);
  const [lightBranch, darkBranch] = main;
  assert.deepEqual(lightBranch.media[1], "not all and (prefers-color-scheme: dark)");
  for (const [rule, branch] of [[lightBranch, "light"], [darkBranch, "dark"]]) {
    const scope = scopeOf("dark", branch);
    // The root and every nested island of the plan, unless an unsafe island depends on it, or it
    // is protected UI or inside it, or it is past the sixth island and holds protected UI.
    assert.deepEqual(rule.selectors, [`${scope.eligible}${UNPROTECTED}:not(${scope.deep}:has(${PROTECTED_UI}))`]);
    assert.ok(scope.eligible.startsWith(`${scope.themed}:not(`));
  }
  const themedOf = (rule) => compounds(rule.selectors[0].slice(0, rule.selectors[0].indexOf(":not(")));
  assert.deepEqual(themedOf(lightBranch).sort(), [
    "[data-color-mode=light][data-light-theme=light]", "[data-color-mode=dark][data-dark-theme=dark]", "[data-color-mode=dark][data-dark-theme=dark_dimmed]",
    "[data-color-mode=auto][data-light-theme=light]", "[data-color-mode=auto][data-light-theme=dark]", "[data-color-mode=auto][data-light-theme=dark_dimmed]",
  ].sort());
  assert.deepEqual(themedOf(darkBranch).filter((c) => c.startsWith("[data-color-mode=auto]")).sort(), ["[data-color-mode=auto][data-dark-theme=light]", "[data-color-mode=auto][data-dark-theme=dark]", "[data-color-mode=auto][data-dark-theme=dark_dimmed]"].sort());
  // No blanket rule on every theme attribute and no substring matching.
  assert.doesNotMatch(withoutProtected(css), /\[data-(?:light|dark)-theme\]\s*\{|:root\s*[,{]|\*=|\^=|\$=/);
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

test("unsafe islands are every island but the frozen mode combinations and the Brand footer's and pages'", () => {
  const LOOSE = "[data-color-mode]:not([data-light-theme],[data-dark-theme])";
  const BRAND_LOOSE = `${LOOSE}:is([data-color-mode=light],[data-color-mode=dark])`;
  const WRAPPER = `react-partial[partial-name="marketing-footer"] > div > ${BRAND_LOOSE}`;
  const PAGE = `:is(main.font-mktg > react-app > div > ${BRAND_LOOSE})`;
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
    // partial's and those inside its footer, and a Brand page's marketing app island and those
    // inside it, while their value is light or dark.
    assert.ok(unsafe.endsWith(`,${LOOSE}:not(${WRAPPER},:is(${WRAPPER} > footer[role="contentinfo"]) ${BRAND_LOOSE},${PAGE},${PAGE} ${BRAND_LOOSE}))`), branch);
    // Browsers reject a :has() nested in another; each suppression depth has its own.
    for (const selector of [eligible, unsafe, others]) for (const arg of hasArguments(selector)) assert.doesNotMatch(arg, /:has\(/);
    // Six exact depths, then two for deeper islands.
    assert.equal(hasArguments(eligible).length, 8);
    assert.doesNotMatch(unsafe + others, /:has\(/);
    // One compound led by the color-mode attribute, so its :has() is one walk keyed to it.
    assert.ok(others.startsWith("[data-color-mode]:not(") && others.endsWith(")") && !/[ >]/.test(others.slice(0, others.indexOf(":not("))));
  }
});

test("component rules follow a subject's own island, then the nearest island: the switch, and selectors in Gecko without it", () => {
  const [resolved, p] = themed("light");
  const { css } = compileGitHub(resolved, p, PREFS);
  const all = rules(css);
  const graph = all.filter((r) => r.selectors.some((s) => s.startsWith(".js-highlight-blob")));
  assert.equal(graph.length, 6);
  const branchOf = (r) => (r.media[1].startsWith("not") ? "light" : "dark");
  // A graph that is itself an island takes the theme only through its own themed mode.
  const own = graph.filter((r) => r.media.length === 2);
  assert.equal(own.length, 2);
  for (const r of own) {
    const scope = scopeOf("light", branchOf(r));
    // Each alternative keeps its own leading key, and protected UI keeps GitHub's graph.
    assert.deepEqual(r.selectors, GRAPH.split(/,(?=\.)/).map((t) => `${t}${scope.themed}:not(:has(${scope.unsafe}))${UNPROTECTED}`));
  }
  // Only Gecko without style queries, before Firefox 151, which also first accepts
  // position-anchor:normal, runs the selector fallback.
  const gecko = graph.filter((r) => r.media.includes("selector(:-moz-focusring) and (not (position-anchor: normal))"));
  assert.equal(gecko.length, 2);
  // One nested rule per branch holds every Gecko subject, its parent test last. The parent names
  // the subjects first, graph alternatives among them, so any other element fails at once.
  for (const r of gecko) {
    const parent = r.selectors[0].slice(r.selectors[0].indexOf(":not([data-color-mode]):is(") + ":not([data-color-mode]):is(".length, -1);
    assert.ok(parent.startsWith(`:is(${GRAPH},`), parent.slice(0, 80));
    assert.ok(parent.endsWith(`)${UNPROTECTED}${scopeOf("light", branchOf(r)).nearest}`));
    assert.deepEqual(r.selectors, GRAPH.split(/,(?=\.)/).map((t) => `${t}:not([data-color-mode]):is(${parent})`));
  }
  // Every engine with container style queries reads the switch, through any depth.
  const queried = graph.filter((r) => r.media.includes("style(--reskin-on: 1)"));
  assert.equal(queried.length, 2);
  for (const r of queried) {
    assert.deepEqual(r.media.slice(2), ["style(--reskin-on: 1)"]);
    assert.equal(r.selectors.length, 2);
    // The style query reads the parent's switch, so a subject that is an island never matches,
    // and protected UI and everything inside it are refused.
    for (const s of r.selectors) {
      assert.ok(s.endsWith(`:not([data-color-mode])${UNPROTECTED}`), s);
      assert.doesNotMatch(s.replaceAll(PROTECTED_UI, ""), /data-color-mode=|:has/);
    }
    const values = Object.fromEntries(r.declarations.map((d) => [d.name, d.value]));
    assert.deepEqual(values, { fill: colorAt(resolved, "/graph/4"), stroke: colorAt(resolved, "/graph/4"), "background-color": colorAt(resolved, "/graph/3") });
  }
  // Themed islands raise the switch and carry the selection colors; every other island with
  // theme attributes clears them, at no specificity.
  const main = all.find(raises);
  const decl = Object.fromEntries(main.declarations.map((d) => [d.name, d.value]));
  assert.equal(decl["--reskin-on"], "1");
  assert.equal(decl["--reskin-selection-text"], colorAt(resolved, "/tokens/selectionText"));
  assert.equal(decl["--reskin-selection-background"], colorAt(resolved, "/tokens/selectionBackground"));
  // And every audited scalar variable advanced CSS and owned decorations read.
  for (const [name, value] of Object.entries(cssVariables(resolved))) assert.equal(decl[name], value, name);
  const reset = all.filter((r) => r.selectors[0].startsWith(":where(") && r.declarations.some((d) => d.name === "--reskin-on" && d.value === "initial"));
  assert.equal(reset.length, 2);
  for (const r of reset) {
    assert.deepEqual(r.selectors, [":where([data-color-mode]:is([data-light-theme],[data-dark-theme]))"]);
    assert.deepEqual(r.declarations.map((d) => [d.name, d.value]), [["--reskin-on", "initial"], ...Object.keys(CSS_VARIABLES).map((name) => [name, "initial"]), ["scrollbar-color", "auto"]]);
    // The scrollbar reset is not important, so GitHub's own scrollbar rules keep winning there.
    assert.equal(r.declarations.at(-1).important, false);
  }
});

test("structured component rules never reach protected UI or anything inside it, and protected UI clears the switches", () => {
  for (const prefs of [{ ...PREFS, appearance: "full" }, { ...PREFS, appearance: "calm" }]) {
    const [resolved, p] = themed("dark");
    resolved.appearance = { ...resolved.appearance, shape: { corners: { style: "bevel", radius: 12 }, borders: { width: 4, style: "solid", color: "#123456" }, shadows: { style: "glow", color: "#fcee0a", opacity: 0.6, blur: 24, offset: 0 }, buttons: { style: "bevel", radius: 8 }, avatar: null } };
    const { css } = compileGitHub(resolved, p, prefs);
    const all = rules(css);
    // Protected UI's own native values: under a style query on the nearest island's mode, and
    // through the selector fallback.
    const restoring = (r) => r.media.some((m) => m.includes("style(--reskin-mode:")) || r.selectors[0].startsWith(`:is(${PROTECTED_UI}):not(`);
    // Every rule that styles a GitHub element rather than an island: components, graph, labels
    // and scroll containers, in every engine path.
    const styled = all.filter((r) => r.declarations.length && !restoring(r) && !r.selectors.some((s) => s.startsWith(":where(") || s.includes("[data-color-mode]:not([data-light-theme],[data-dark-theme])") || s.startsWith("header.HeaderMktg") || s.startsWith(":root") || s.startsWith("::selection") || s.startsWith(":is([data-color-mode=")) && r.selectors.join(",") !== PROTECTED_UI);
    assert.ok(styled.length > 12, prefs.appearance);
    // Every path refuses protected UI and everything inside it, under the style query too.
    for (const r of styled) for (const s of r.selectors) assert.ok(s.includes(UNPROTECTED), `${prefs.appearance} ${r.media.join(" ")} ${s.slice(0, 80)}`);
    // Protected UI clears every Reskin switch, after both branches, as a native island does.
    const guard = all.at(-2);
    assert.deepEqual(guard.selectors, PROTECTED_UI.split(/,(?=[a-z.[])/));
    assert.deepEqual(guard.media, ["not all and (forced-colors: active)"]);
    assert.deepEqual(guard.declarations.map((d) => [d.name, d.value, d.important]), [["--reskin-on", "initial", true], ...Object.keys(CSS_VARIABLES).map((name) => [name, "initial", true])]);
  }
});

test("protected UI takes back its nearest island's own native values for each covered mode under the style query, or the seed mode's where they do not read on the theme's canvas, and the seed mode's through the selector fallback", () => {
  const [resolved, p] = themed("dark");
  const all = rules(compileGitHub(resolved, p, PREFS).css);
  const covered = coveredModes(MODE_INDEX, "dark");
  const ATTRIBUTED = "[data-color-mode]:is([data-light-theme],[data-dark-theme])";
  const own = (mode) => new Map(MODE_INDEX.restoreCss[mode].split(";").map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1)]));
  // The last declaration of each name wins.
  const check = (r, mode, overrides = {}) => {
    const values = new Map([...own(mode), ...Object.entries(overrides)]);
    const base = MODE_INDEX.modes[mode].base;
    const got = Object.fromEntries(r.declarations.map((d) => [d.name, d.value]));
    for (const d of r.declarations) assert.equal(d.important, false, `${mode} ${d.name}`);
    for (const [name, value] of Object.entries(got)) {
      if (name === "color-scheme") assert.equal(value, base);
      else if (name.startsWith("--lightningcss-")) assert.equal(value.trim(), (name === `--lightningcss-${base}`) ? "initial" : "");
      else assert.equal(value, values.get(name), `${mode} ${name} is GitHub's own`);
    }
    return got;
  };
  // Engines with style queries: once, after both branches, on protected UI that is no island.
  const queried = (css) => rules(css).filter((r) => r.media.some((m) => m.includes("style(--reskin-mode:")));
  const expectRestored = (css, modes, overrides) => {
    const restored = queried(css);
    assert.deepEqual(restored.map((r) => r.media), covered.map((mode) => ["not all and (forced-colors: active)", `style(--reskin-on: 1) and style(--reskin-mode: ${mode})`]));
    for (const [i, r] of restored.entries()) {
      assert.deepEqual(r.selectors, PROTECTED_UI.split(/,(?=[a-z.[])/).map((s) => `${s}:not(${ATTRIBUTED})`));
      // No canvas is painted behind protected UI: a block's background extends under the floats
      // beside it, where it would sit under themed text.
      assert.ok(r.declarations.every((d) => d.name !== "background-color" && d.name !== "color"), covered[i]);
      check(r, modes[i], overrides);
    }
    return restored;
  };
  // GitHub's light text does not read on a dark canvas, so protected UI in a light island under a
  // dark theme takes back dark's values, the seed's; the dark islands keep their own.
  const restored = expectRestored(compileGitHub(resolved, p, PREFS).css, covered.map((mode) => (mode === "light" ? "dark" : mode)));
  assert.deepEqual(restored[covered.indexOf("light")].declarations, restored[covered.indexOf("dark")].declarations);
  // On a lighter dark canvas, like Nord's, where dark's muted text reads at 4.29:1, every island
  // takes back dark's values with dark's default text for its muted text.
  const nord = resolvedFromSeed(MODE_INDEX.modes.dark, { "/tokens/canvas": "#2e3440" });
  assert.ok(contrast(own("dark").get("--fgColor-muted"), "#2e3440") < 4.5);
  assert.ok(contrast(own("dark").get("--fgColor-default"), "#2e3440") >= 4.5);
  expectRestored(compileGitHub(nord, p, PREFS).css, covered.map(() => "dark"), { "--fgColor-muted": own("dark").get("--fgColor-default") });
  for (const branch of ["light", "dark"]) {
    const scope = scopeOf("dark", branch);
    const media = branch === "light" ? "not all and (prefers-color-scheme: dark)" : "(prefers-color-scheme: dark)";
    // Each covered island names its mode for protected UI inside it.
    for (const mode of covered) {
      const tag = all.filter((r) => r.media[1] === media && r.selectors[0] === scope.mode(mode));
      assert.deepEqual(tag.map((r) => r.declarations.map((d) => [d.name, d.value])), [[["--reskin-mode", mode]]]);
    }
    // Gecko before Firefox 151 finds a themed nearest island by selector through six islands, one
    // neither protected nor inside protected UI, and takes back GitHub's own values for the seed's
    // mode.
    const fallback = all.filter((r) => r.media[1] === media && r.selectors[0].startsWith(`:is(${PROTECTED_UI}):not(`));
    assert.equal(fallback.length, 1);
    assert.deepEqual(fallback[0].media.slice(2), ["selector(:-moz-focusring) and (not (position-anchor: normal))"]);
    assert.deepEqual(fallback[0].selectors, [`:is(${PROTECTED_UI})${scope.shallow}:not(:is(${PROTECTED_UI}) ${ATTRIBUTED} *,${ATTRIBUTED}:is(${PROTECTED_UI}) *)`]);
    assert.ok(scope.nearest.startsWith(scope.shallow.slice(0, -1)));
    check(fallback[0], "dark");
  }
});

test("every catalog theme's protected UI reads at 4.5:1 on its canvas in every covered island, with no canvas behind it", () => {
  for (const entry of readJson("themes/catalog.json")) {
    const theme = readJson(entry.file);
    for (const seed of Object.values(MODE_INDEX.modes).filter((m) => m.base === theme.base && !m.highContrast && coveredModes(MODE_INDEX, m.id).length)) {
      const resolved = resolveTheme(theme, { seed, policy: "themed", reducedMotion: false, forcedColors: false });
      const canvas = colorAt(resolved, "/tokens/canvas");
      const baseline = new Map(MODE_INDEX.nativeCss[seed.id].split(";").map((d) => [d.slice(0, d.indexOf(":")), d.slice(d.indexOf(":") + 1)]));
      const restored = rules(compileGitHub(resolved, { seedMode: seed.id, policy: "themed" }, PREFS).css).filter((r) => r.media.some((m) => m.includes("style(--reskin-mode:")));
      assert.equal(restored.length, coveredModes(MODE_INDEX, seed.id).length);
      for (const r of restored) {
        const got = new Map([...baseline, ...r.declarations.map((d) => [d.name, d.value])]);
        assert.ok(!got.has("background-color"), `${entry.slug} ${r.media[1]}`);
        for (const name of ["--fgColor-default", "--fgColor-muted"]) assert.ok(contrast(got.get(name), canvas) >= 4.5, `${entry.slug} on ${seed.id}, ${r.media[1]}: ${name} ${got.get(name)} on ${canvas}`);
      }
    }
  }
});

test("selection theming is optional: without it both engines keep the browser's own selection colors", () => {
  const [resolved, p] = themed("dark");
  const withSelection = compileGitHub(resolved, p, PREFS);
  const without = compileGitHub(resolved, p, PREFS, MODE_INDEX, { selection: false });
  assert.match(withSelection.css, /::selection/);
  assert.doesNotMatch(without.css, /::selection/);
  assert.notEqual(without.fingerprint, withSelection.fingerprint);
  // Everything else is the same stylesheet, the islands' selection variables included.
  assert.equal(compileGitHub(resolved, p, PREFS, MODE_INDEX, { selection: true }).css, withSelection.css);
  assert.match(without.css, /--reskin-selection-text:/);
  assert.throws(() => compileGitHub(resolved, p, PREFS, MODE_INDEX, { selection: "no" }), /selection option must be a boolean/);
});

test("scrollbar colors reach the viewport through the root island and GitHub's scroll containers, not every element", () => {
  const [resolved, p] = themed("dark");
  const all = rules(compileGitHub(resolved, p, PREFS).css);
  const thumb = resolved.appearance.colors.scrollbar;
  const color = `${thumb.thumb} ${thumb.track}`;
  // The eligible island itself carries them, for the viewport.
  const main = all.find(raises);
  assert.equal(main.declarations.find((d) => d.name === "scrollbar-color").value, color);
  // Its children start again from the browser's, at no specificity, so GitHub's own rules win.
  const reset = all.filter((r) => r.selectors[0] === ":where([data-color-mode]:is([data-light-theme],[data-dark-theme])) > *");
  assert.equal(reset.length, 2);
  for (const r of reset) assert.deepEqual(r.declarations.map((d) => [d.name, d.value, d.important]), [["scrollbar-color", "auto", false]]);
  // Scroll containers take them where their nearest island is eligible.
  const scrollers = all.filter((r) => r.selectors.some((s) => s.startsWith("pre:not([data-color-mode])")));
  assert.equal(scrollers.length, 4);
  for (const r of scrollers) assert.equal(r.declarations.find((d) => d.name === "scrollbar-color").value, color);
});

test("the activity timeline's commit bars are recolored only through their verified structure", () => {
  const [resolved, p] = themed("dark");
  const { css } = compileGitHub(resolved, p, PREFS);
  const bars = rules(css).filter((r) => r.selectors.some((s) => s.startsWith(".Progress-item")));
  assert.equal(bars.length, 6);
  for (const r of bars) {
    assert.match(r.selectors.find((s) => s.startsWith(".Progress-item")), /^\.Progress-item:is\(main #js-contribution-activity \.Progress\[role="img"\] > \*\):not\(\.markdown-body \*\)/);
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
  assert.doesNotMatch(withoutProtected(css), /<|script|alert|url\(|@import|https?:|expression\(/i);
  const hostile = resolvedFromSeed(MODE_INDEX.modes.dark, { "/tokens/canvas": "#000;}*{x:y" });
  assert.throws(() => compileGitHub(hostile, p, PREFS), /lowercase #rrggbb/);
  const upper = resolvedFromSeed(MODE_INDEX.modes.dark, { "/tokens/text": "#FFFFFF" });
  assert.throws(() => compileGitHub(upper, p, PREFS), /lowercase #rrggbb/);
  const badIndex = { ...MODE_INDEX, nativeCss: { ...MODE_INDEX.nativeCss, dark: "--x:red}body{display:none" } };
  assert.throws(() => compileGitHub(resolved, p, PREFS, badIndex), /unsafe declaration/);
  const badRestore = { ...MODE_INDEX, restoreCss: { ...MODE_INDEX.restoreCss, dark_dimmed: "--bgColor-default:red}body{display:none" } };
  assert.throws(() => compileGitHub(resolved, p, PREFS, badRestore), /restoreCss\.dark_dimmed has an unsafe declaration/);
  // Without a covered mode's restoring baseline, nothing compiles that would leave protected UI themed.
  const { light, ...partial } = MODE_INDEX.restoreCss;
  assert.throws(() => compileGitHub(resolved, p, PREFS, { ...MODE_INDEX, restoreCss: partial }), /restoreCss has no light baseline/);
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
  // The footer's Brand canvas is the inset; a Brand page's is the canvas.
  const brand = rules(css).filter((r) => r.declarations.some((d) => d.name === "--brand-color-canvas-default" && d.value === colorAt(resolved, "/tokens/inset")));
  // Its own mode, the switch and Gecko's selectors, in each color-scheme branch.
  assert.equal(brand.length, 6);
  for (const r of brand) {
    assert.ok(r.selectors.every((s) => s.startsWith(':is(:is(react-partial[partial-name="marketing-footer"]') || s.startsWith(":is(:not(")));
    assert.doesNotMatch(r.selectors.join(","), /class/);
    assert.equal(r.declarations.find((d) => d.name === "--brand-color-text-default").value, colorAt(resolved, "/tokens/text"));
  }
});

test("issue labels use GitHub's formula for the theme's base, not the native mode name", () => {
  for (const [seedMode, threshold] of [["dark", ".6"], ["light", ".453"]]) {
    const [resolved, p] = themed(seedMode);
    const labels = rules(compileGitHub(resolved, p, PREFS).css).filter((r) => r.selectors.some((s) => s.startsWith(".hx_IssueLabel")));
    assert.equal(labels.length, 6, seedMode);
    for (const r of labels) {
      assert.equal(r.declarations.find((d) => d.name === "--lightness-threshold").value, threshold);
      assert.ok(r.declarations.every((d) => d.important));
    }
  }
});
