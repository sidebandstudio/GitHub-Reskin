// The Evangelion, Dandadan, Solo Leveling and Demon Slayer themes at the full-transformation
// standard: their source needs no repair, and on every themed production seed Full draws every
// page and header layer they request. A layer whose pixels would put text under 4.5:1 makes the
// paint check drop the whole stack without failing anything else, so this is checked here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { structuredPlan } from "../../packages/appearance/paint.js";
import { repairTheme, resolveTheme } from "../../packages/engine/index.js";
import { MODE_INDEX, standardSeed } from "../../packages/primer/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const THEMES = [
  ["violet-synchrony", "Neon Genesis Evangelion", "barlow-condensed", "barlow"],
  ["occult-orbit", "Dandadan", "bungee", "barlow"],
  ["gatewake-protocol", "Solo Leveling", "rajdhani", "ibm-plex-sans"],
  ["wisteria-emberline", "Demon Slayer", "cormorant-garamond", "source-sans-3"],
];
const FULL = Object.freeze({ enabled: true, appearance: "full", extras: true, text: true, motion: true, fonts: true, effects: true });
const CALM = Object.freeze({ ...FULL, appearance: "calm", extras: false });
const seeds = Object.values(MODE_INDEX.modes).filter((seed) => !seed.highContrast && seed.base === "dark");

for (const [slug, title, heading, body] of THEMES) {
  const theme = JSON.parse(readFileSync(`${ROOT}themes/anime/${slug}.reskin.json`, "utf8"));

  test(`${title} needs no source repair and keeps its title, role fonts and flavor`, () => {
    assert.equal(theme.inspiredBy, title);
    assert.equal(theme.base, "dark");
    assert.deepEqual(theme.fonts, { body, heading });
    assert.equal(theme.typography.uppercaseHeadings, false, "user content keeps its case");
    assert.deepEqual(repairTheme(theme, standardSeed(MODE_INDEX, "dark")).repairs, []);
    assert.equal(Object.keys(theme.flavor.slots).length, 10);
  });

  test(`${title} Full draws every requested page and header layer on every themed dark seed, and Calm none`, () => {
    assert.ok(seeds.length >= 4);
    for (const seed of seeds) {
      const resolved = resolveTheme(theme, { seed, policy: "themed", reducedMotion: false, forcedColors: false });
      assert.deepEqual(resolved.pairAudit.filter((pair) => !pair.passed), [], seed.id);
      const full = structuredPlan(resolved, FULL);
      assert.deepEqual(full.notes, [], seed.id);
      assert.equal(full.page.layers.length, theme.backgrounds.page.layers.length, seed.id);
      assert.equal(full.header.layers.length, theme.backgrounds.header.layers.length, seed.id);
      const calm = structuredPlan(resolved, CALM);
      assert.equal(calm.page.color, theme.backgrounds.page.color, seed.id);
      assert.deepEqual(calm.page.layers, [], seed.id);
    }
  });
}
