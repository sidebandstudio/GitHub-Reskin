// Preference gating, owned-node limits and the compiled CSS, from resolved themes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { FLAVOR_SLOT_IDS } from "../../packages/contracts/index.js";
import { repairTheme, resolveTheme } from "../../packages/engine/index.js";
import { boundedParams, compileAppearance, effectNodes, effectiveAppearance, ownedNodePlan, planAppearance } from "../../packages/appearance/index.js";
import { PAGE_SLOTS, auditDocuments, loadThemes, themeAudit } from "../../packages/appearance/audit.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const read = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const seeds = { dark: read("tests/fixtures/seeds/standard-dark.json"), light: read("tests/fixtures/seeds/standard-light.json") };
const ON = Object.freeze({ enabled: true, extras: true, text: true, motion: true, fonts: true, effects: true });
const resolve = (theme, context = {}) => resolveTheme(repairTheme(theme, seeds[theme.base]).theme, { seed: seeds[theme.base], policy: "themed", reducedMotion: false, forcedColors: false, ...context });
const choom = read("tests/fixtures/schema/valid/choom-circuit.reskin.json");

test("effective appearance follows the master, extras, child switches, flavor request and motion rules", () => {
  const r = resolve(choom);
  assert.deepEqual({ ...effectiveAppearance(r, ON) }, { text: true, fonts: true, effects: true, motion: true });
  assert.deepEqual({ ...effectiveAppearance(r, { ...ON, enabled: false }) }, { text: false, fonts: false, effects: false, motion: false });
  assert.deepEqual({ ...effectiveAppearance(r, { ...ON, extras: false }) }, { text: false, fonts: false, effects: false, motion: false });
  assert.deepEqual({ ...effectiveAppearance(r, { ...ON, effects: false }) }, { text: true, fonts: true, effects: false, motion: false });
  assert.deepEqual({ ...effectiveAppearance(r, { ...ON, motion: false }) }, { text: true, fonts: true, effects: true, motion: false });
  assert.equal(effectiveAppearance(resolve(choom, { reducedMotion: true }), ON).motion, false);
  // flavor.enabled gates text only; fonts and effects keep their own switches.
  const quiet = resolve({ ...choom, flavor: { ...choom.flavor, enabled: false } });
  assert.deepEqual({ ...effectiveAppearance(quiet, ON) }, { text: false, fonts: true, effects: true, motion: true });
  const native = resolveTheme(choom, { seed: null, policy: "native-unknown", reducedMotion: false, forcedColors: false });
  assert.deepEqual({ ...effectiveAppearance(native, ON) }, { text: false, fonts: false, effects: false, motion: false });
});

test("worst-case themes stay within 24 owned and six animated nodes and keep every copy on every page", () => {
  assert.deepEqual(PAGE_SLOTS.flat().sort(), [...FLAVOR_SLOT_IDS].sort());
  for (const [label, theme] of loadThemes(read("themes/classics/dracula.reskin.json"))) {
    for (const slots of PAGE_SLOTS) {
      const plan = planAppearance(resolve(theme), ON, slots);
      assert.ok(plan.owned <= 24 && plan.animated <= 6, `${label}: ${plan.owned}/${plan.animated}`);
      assert.equal(plan.slots.filter((s) => s.copy).length, slots.length, label);
      assert.equal(ownedNodePlan(resolve(theme), ON, slots).length, plan.owned, label);
    }
  }
});

test("only the first box moves, and a static box keeps one resting fleck", () => {
  const drift = boundedParams("drift", { count: 4 });
  assert.deepEqual(effectNodes("drift", drift, { box: "strip", primary: true, motion: true }).map((n) => n.animated), [true, true, true, true]);
  assert.deepEqual(effectNodes("drift", drift, { box: "strip", primary: false, motion: true }).map((n) => n.animated), [false]);
  assert.deepEqual(effectNodes("drift", drift, { box: "strip", primary: true, motion: false }).map((n) => n.animated), [false]);
  assert.deepEqual(effectNodes("drift", drift, { box: "badge", primary: true, motion: true }), []);
  assert.deepEqual(boundedParams("rail", { shape: "spiral", opacity: 9, thickness: 2.6 }), { shape: "slash", opacity: 0.4, thickness: 3 });
});

test("flavor copy never enters CSS, and CSS is deterministic", () => {
  const r = resolve(choom);
  const css = compileAppearance(r, ON, "github");
  for (const text of Object.values(choom.flavor.slots)) assert.ok(!css.includes(text), text);
  assert.ok(!css.includes(choom.name));
  assert.equal(css, compileAppearance(resolve(choom), ON, "github"));
  assert.match(css, /pointer-events:none!important/);
  // Both targets emit the same declarations, so a theme's owned CSS reaches the same properties.
  assert.equal(compileAppearance(r, ON, "preview").replace(/!important/g, ""), css.replace(/!important/g, ""));
  assert.throws(() => compileAppearance(r, ON, "elsewhere"), /target/);
});

test("every Classic and load theme passes the theme audit", async () => {
  const documents = await auditDocuments(ROOT);
  assert.ok(documents.length >= 12 + 120);
  const { problems, count } = await themeAudit(ROOT, documents);
  assert.deepEqual(problems, []);
  assert.ok(count > 1000);
});
