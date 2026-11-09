// overrides.accentEmphasis through the Primer adapter: GitHub's selected and emphasized accent
// states read --bgColor-accent-emphasis with --fgColor-onEmphasis (on 2026-11-09 the profile's
// selected year link, the skip links and the page-load bar on github.com/whoisaldo), which the
// mapping emits from tokens.accentEmphasis and tokens.emphasisText, in Full and Calm. Native
// islands stay native, and a theme without the override compiles as main 127233c did. The
// art-additions fixture's hashes were recorded again when its body font, Barlow, gained files.
import assert from "node:assert/strict";
import test from "node:test";
import { contrast, repairTheme, resolveTheme } from "../../packages/engine/index.js";
import { compileGitHub, emittedColors, MODE_INDEX, seedFor, selectMode, standardSeed } from "../../packages/primer/index.js";
import { compileHashes, withoutAdded } from "./compile-baseline.mjs";
import { EXTRAS_OFF, PREFS, readJson, ROOT } from "./helpers.mjs";

const EMPHASIS = readJson("tests/fixtures/schema/valid/slots-emphasis.reskin.json");
const TEAL = EMPHASIS.overrides.accentEmphasis;
const CALM = { ...PREFS, extras: false };
const nativeFor = (mode) => ({ colorMode: mode.base, lightTheme: mode.base === "light" ? mode.id : "light", darkTheme: mode.base === "dark" ? mode.id : "dark", systemDark: false });
const resolveOn = (theme, plan) => resolveTheme(repairTheme(theme, standardSeed(MODE_INDEX, theme.base)).theme, { seed: seedFor(MODE_INDEX, plan), policy: plan.policy, reducedMotion: false, forcedColors: false });
// The value the stylesheet's themed island rule gives a GitHub variable.
const declared = (css, name) => [...css.matchAll(new RegExp(`${name}:(#[0-9a-f]{6})`, "g"))].map((m) => m[1]);

test("without the override, every Classic and fixture compiles in Full and Calm exactly as on main 127233c, but for the two added variables", async () => {
  const pinned = readJson("tests/primer/fixtures/main-127233c-compiles.json");
  const files = [...new Set(Object.keys(pinned).map((key) => key.split(" ")[0]))];
  assert.equal(files.length, 25);
  for (const file of files) assert.equal(readJson(file).overrides?.accentEmphasis, undefined, file);
  const hashes = await compileHashes(ROOT, files);
  // Since embedded images draw, the image fixture's Full appearance plans its requested banner
  // region, which main left out with the image; its Calm output and every other theme are as on main.
  const RASTER = "tests/fixtures/schema/valid/embedded-images.reskin.json";
  for (const key of Object.keys(pinned).filter((k) => k.startsWith(`${RASTER} `) && k.endsWith(" full"))) {
    assert.notEqual(hashes[key].appearance, pinned[key].appearance, key);
    hashes[key] = { ...hashes[key], appearance: pinned[key].appearance };
  }
  assert.deepEqual(hashes, pinned);
});

test("the override drives GitHub's emphasis fill and its ink in Full and Calm on every themed mode of its base", () => {
  const themedModes = Object.values(MODE_INDEX.modes).filter((m) => m.base === EMPHASIS.base && !m.highContrast);
  assert.ok(themedModes.length >= 4);
  for (const mode of themedModes) {
    const plan = selectMode(nativeFor(mode), EMPHASIS.base, MODE_INDEX);
    const resolved = resolveOn(EMPHASIS, plan);
    assert.equal(resolved.tokens.accentEmphasis, TEAL, mode.id);
    const emitted = new Map(emittedColors(resolved));
    assert.equal(emitted.get("--bgColor-accent-emphasis"), TEAL, mode.id);
    assert.equal(emitted.get("--fgColor-onEmphasis"), resolved.tokens.emphasisText, mode.id);
    for (const prefs of [PREFS, CALM, EXTRAS_OFF]) {
      const { css } = compileGitHub(resolved, plan, prefs);
      assert.ok(declared(css, "--bgColor-accent-emphasis").includes(TEAL), `${mode.id} extras:${prefs.extras}`);
      assert.ok(declared(css, "--reskin-accent-emphasis").includes(TEAL), `${mode.id} extras:${prefs.extras}`);
      assert.ok(declared(css, "--reskin-accent-emphasis-text").includes(resolved.tokens.emphasisText), `${mode.id} extras:${prefs.extras}`);
    }
    // The same theme without the override fills those states with its own accent emphasis.
    const { overrides, ...plainTheme } = EMPHASIS;
    assert.deepEqual(Object.keys(overrides), ["accentEmphasis"]);
    const plain = resolveOn(plainTheme, plan);
    assert.notEqual(plain.tokens.accentEmphasis, TEAL);
    assert.ok(!declared(compileGitHub(plain, plan, PREFS).css, "--bgColor-accent-emphasis").includes(TEAL), mode.id);
    // Only the emphasis variables follow the override: the rest of the stylesheet is the same.
    const strip = (css) => withoutAdded(css).replace(/--(?:bgColor-accent-emphasis|fgColor-onEmphasis|diffBlob-hunkNum-bgColor-hover|control-checked-(?:bg|border)Color-(?:rest|hover|active)):#[0-9a-f]{6}/g, "");
    assert.equal(strip(compileGitHub(resolved, plan, PREFS).css), strip(compileGitHub(plain, plan, PREFS).css), mode.id);
  }
});

test("on the review's mid-gray canvas, GitHub's emphasis fill and its ink stay readable before and after source repair", () => {
  const theme = { schemaVersion: 1, name: "Mid gray", base: "dark", colors: { background: "#666666", text: "#ffffff", accent: TEAL }, overrides: { accentEmphasis: TEAL } };
  const context = { seed: standardSeed(MODE_INDEX, "dark"), policy: "themed", reducedMotion: false, forcedColors: false };
  for (const source of [theme, repairTheme(theme, context.seed).theme]) {
    const emitted = new Map(emittedColors(resolveTheme(source, context)));
    const [fill, ink] = ["--bgColor-accent-emphasis", "--fgColor-onEmphasis"].map((name) => emitted.get(name));
    assert.ok(contrast(ink, fill) >= 4.5 && contrast(fill, "#666666") >= 3, `${fill} with ${ink}`);
  }
});

test("high-contrast islands stay native with the override", () => {
  for (const mode of Object.values(MODE_INDEX.modes).filter((m) => m.highContrast)) {
    const plan = selectMode(nativeFor(mode), EMPHASIS.base, MODE_INDEX);
    assert.equal(plan.policy, "native-high-contrast", mode.id);
    const resolved = resolveOn(EMPHASIS, plan);
    for (const prefs of [PREFS, CALM]) assert.equal(compileGitHub(resolved, plan, prefs).css, "", mode.id);
  }
});
