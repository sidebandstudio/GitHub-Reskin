// The preview compile target: only the variables and component rules a preview fixture reads,
// with the same mappings, fallbacks, island and forced-color guards and its own fingerprint.
import assert from "node:assert/strict";
import test from "node:test";
import { parseStylesheet } from "../../packages/primer/css.js";
import { BRAND_HEADER, COMPONENT_IDS, compileGitHub, compilePreview, emittedColors, MODE_INDEX, selectMode } from "../../packages/primer/index.js";
import { appearanceFor, PREFS, resolvedFromSeed } from "./helpers.mjs";

const plan = selectMode({ colorMode: "dark", lightTheme: "light", darkTheme: "dark", systemDark: true }, "dark", MODE_INDEX);
const seed = MODE_INDEX.modes[plan.seedMode];
const resolved = resolvedFromSeed(seed);
resolved.appearance = appearanceFor(seed.colors, {
  shape: { corners: { style: "bevel", radius: 12 }, borders: { width: 1, style: "solid", color: "#2d2a52" }, shadows: { style: "neon", color: "#fcee0a", opacity: 0.55, blur: 14, offset: 0 }, buttons: { style: "bevel", radius: 8 }, avatar: null },
  graph: { cellStyle: "glow", cellRadius: 1, glow: { radius: 9, opacity: 0.85, levels: [1, 2, 3, 4], color: null } },
});
const FULL = { ...PREFS, appearance: "full" };
// The variables and components C5's whoisaldo fixture reads.
const VARIABLES = ["--bgColor-default", "--fgColor-default", "--fgColor-accent", "--borderColor-default", "--prettylights-syntax-keyword", "--diffBlob-additionLine-bgColor", "--contribution-default-bgColor-4"];
const COMPONENTS = ["selection", "scrollbar", "box", "box-first", "box-last", "box-border", "label-color", "label-shape", "cell-shape", "svg-cell-shape", "cell-glow-1", "cell-glow-2", "cell-glow-3", "cell-glow-4"];

const declared = (css) => {
  const out = new Map();
  for (const rule of parseStylesheet(css).flatMap(function flat(r) {
    return r.type === "rule" ? [r] : (r.rules ?? []).flatMap(flat);
  }))
    for (const d of rule.declarations) out.set(d.name, d.value);
  return out;
};

test("the preview target writes only the named variables, with the values the full target writes", () => {
  const preview = compilePreview(resolved, plan, FULL, { variables: VARIABLES, components: COMPONENTS });
  const full = compileGitHub(resolved, plan, FULL);
  const values = declared(preview.css);
  const all = emittedColors(resolved);
  for (const name of VARIABLES) assert.equal(values.get(name), all.get(name), name);
  // Nothing else the mapping writes, no native family baseline and no Brand variables.
  for (const name of all.keys()) if (!VARIABLES.includes(name)) assert.equal(values.has(name), false, name);
  assert.equal([...values.keys()].some((n) => n.startsWith("--brand-")), false);
  assert.equal(preview.css.includes(BRAND_HEADER), false);
  // The same guards: forced colors, both color schemes and the frame's root island only.
  assert.match(preview.css, /^\/\* GitHub Reskin: [\w-]+ seed for [\w, ]+, preview \*\/\n@media not all and \(forced-colors: active\)\{/);
  assert.match(preview.css, /@media \(prefers-color-scheme: dark\)\{/);
  assert.match(preview.css, /:root:is\(/);
  // A fraction of the full stylesheet, and its own fingerprint.
  assert.ok(preview.css.length * 5 < full.css.length, `${preview.css.length} vs ${full.css.length}`);
  assert.notEqual(preview.fingerprint, full.fingerprint);
  assert.notEqual(preview.fingerprint, compilePreview(resolved, plan, FULL, { variables: VARIABLES }).fingerprint);
});

test("the preview target keeps only the listed component rules, and refuses what it cannot write", () => {
  const preview = compilePreview(resolved, plan, FULL, { variables: VARIABLES, components: COMPONENTS }).css;
  assert.match(preview, /\.ContributionCalendar-day\[data-level="4"\]/);
  assert.match(preview, /corner-shape:bevel/);
  assert.equal(preview.includes(".btn-primary"), false);
  assert.equal(preview.includes(".hx_IssueLabel"), false);
  assert.equal(preview.includes(".js-highlight-blob"), false);
  for (const id of COMPONENTS) assert.ok(COMPONENT_IDS.includes(id), id);
  // Calm drops the glow there too.
  assert.equal(compilePreview(resolved, plan, { ...PREFS, appearance: "calm" }, { variables: VARIABLES, components: COMPONENTS }).css.includes("box-shadow"), false);
  assert.throws(() => compilePreview(resolved, plan, FULL, { variables: [] }), /list of Primer variables/);
  assert.throws(() => compilePreview(resolved, plan, FULL, { variables: ["--not-a-primer-variable"] }), /does not write: --not-a-primer-variable/);
  assert.throws(() => compilePreview(resolved, plan, FULL, { variables: VARIABLES, components: "box" }), /rule IDs/);
  assert.throws(() => compileGitHub(resolved, plan, FULL, MODE_INDEX, { target: "site" }), /github or preview/);
});

test("the marketing header takes the Brand page mapping where it is a themed island with no unsafe island inside", () => {
  const css = compileGitHub(resolved, plan, FULL).css;
  const rules = parseStylesheet(css).flatMap(function flat(r) {
    return r.type === "rule" ? [r] : (r.rules ?? []).flatMap(flat);
  });
  const header = rules.filter((r) => r.selectors.some((s) => s.startsWith(BRAND_HEADER)));
  assert.ok(header.length >= 2, "an island rule and a rule for a header without theme attributes");
  for (const rule of header) {
    const values = Object.fromEntries(rule.declarations.map((d) => [d.name, d.value]));
    assert.equal(values["--brand-color-canvas-default"], resolved.tokens.canvas);
    assert.equal(values["--brand-button-primary-bgColor-rest"], resolved.tokens.primaryBackground);
    assert.equal(values["--brand-color-text-default"], resolved.tokens.text);
  }
  assert.ok(header.some((r) => r.selectors.every((s) => /:not\(:has\(/.test(s))), "the island rule requires no unsafe island inside");
});
