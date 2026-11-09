import assert from "node:assert/strict";
import test from "node:test";
import { coveredModes, MODE_INDEX, NOTICES, nativeModeId, seedFor, selectMode, standardSeed } from "../../packages/primer/index.js";

const native = (colorMode, lightTheme, darkTheme, systemDark = false) => ({ colorMode, lightTheme, darkTheme, systemDark });
const ids = Object.keys(MODE_INDEX.modes);
const familySeed = { standard: { light: "light", dark: "dark" }, colorblind: { light: "light_colorblind", dark: "dark_colorblind" }, tritanopia: { light: "light_tritanopia", dark: "dark_tritanopia" } };

test("every recognized mode gets an explicit plan for both theme bases", () => {
  for (const id of ids) {
    const mode = MODE_INDEX.modes[id];
    for (const base of ["light", "dark"]) {
      const slot = mode.base === "light" ? native("light", id, "dark") : native("dark", "light", id);
      const plan = selectMode(slot, base, MODE_INDEX);
      assert.ok(Object.isFrozen(plan), `${id} ${base} plan is frozen`);
      if (mode.highContrast) {
        // High contrast stays native: no silent downgrade to a standard or accessibility seed.
        assert.deepEqual({ ...plan }, { seedMode: null, policy: "native-high-contrast", notice: NOTICES.highContrast }, `${id} ${base}`);
      } else {
        assert.equal(plan.policy, "themed", `${id} ${base}`);
        assert.equal(plan.seedMode, familySeed[mode.family][base], `${id} ${base}`);
        assert.equal(plan.notice, mode.family === "standard" ? undefined : NOTICES.accessibility, `${id} ${base}`);
        const seed = seedFor(MODE_INDEX, plan);
        assert.equal(seed.base, base);
        assert.equal(seed.family, mode.family);
        assert.equal(seed.highContrast, false);
      }
    }
  }
});

test("standard light, dark, auto and dimmed use the theme's base", () => {
  assert.equal(selectMode(native("light", "light", "dark"), "dark", MODE_INDEX).seedMode, "dark");
  assert.equal(selectMode(native("dark", "light", "dark"), "light", MODE_INDEX).seedMode, "light");
  assert.equal(selectMode(native("dark", "light", "dark_dimmed"), "dark", MODE_INDEX).seedMode, "dark");
  assert.equal(selectMode(native("dark", "light", "dark_dimmed"), "light", MODE_INDEX).seedMode, "light");
  // Auto follows the system scheme without any setting changing.
  const auto = native("auto", "light_tritanopia", "dark_high_contrast");
  assert.equal(selectMode({ ...auto, systemDark: false }, "dark", MODE_INDEX).seedMode, "dark_tritanopia");
  assert.equal(selectMode({ ...auto, systemDark: true }, "dark", MODE_INDEX).policy, "native-high-contrast");
});

test("unknown, missing and malformed modes keep native colors with a notice", () => {
  for (const n of [native("dark", "light", "dark_sepia"), native("light", "", "dark"), native("light", "light;color:red", "dark"), native("system", "light", "dark"), null, {}]) {
    const plan = selectMode(n, "dark", MODE_INDEX);
    assert.deepEqual({ ...plan }, { seedMode: null, policy: "native-unknown", notice: NOTICES.unknown }, JSON.stringify(n));
  }
  assert.equal(nativeModeId(native("auto", "light", "dark", true)), "dark");
  assert.equal(nativeModeId(native("auto", "light", "dark", false)), "light");
  assert.equal(nativeModeId({ colorMode: "auto", lightTheme: "light", darkTheme: "dark", systemDark: "yes" }), "light");
});

test("a mode without a matching counterpart stays native instead of borrowing another family", () => {
  const broken = { ...MODE_INDEX, counterparts: MODE_INDEX.counterparts.filter((c) => !(c.nativeMode === "light_colorblind" && c.base === "dark")) };
  assert.equal(selectMode(native("light", "light_colorblind", "dark"), "dark", broken).policy, "native-unknown");
  const crossFamily = { ...MODE_INDEX, counterparts: MODE_INDEX.counterparts.map((c) => (c.nativeMode === "light_colorblind" && c.base === "dark" ? { ...c, seedMode: "dark" } : c)) };
  assert.equal(selectMode(native("light", "light_colorblind", "dark"), "dark", crossFamily).policy, "native-unknown");
  const duplicate = { ...MODE_INDEX, counterparts: [...MODE_INDEX.counterparts, { nativeMode: "light", base: "dark", seedMode: "dark" }] };
  assert.equal(selectMode(native("light", "light", "dark"), "dark", duplicate).policy, "native-unknown");
});

test("the index is a required argument and bases are explicit", () => {
  assert.throws(() => selectMode(native("light", "light", "dark"), "dark"), /ModeIndex/);
  assert.throws(() => selectMode(native("light", "light", "dark"), "auto", MODE_INDEX), /dark or light/);
  assert.equal(standardSeed(MODE_INDEX, "dark").id, "dark");
  assert.equal(standardSeed(MODE_INDEX, "light").id, "light");
  assert.deepEqual(coveredModes(MODE_INDEX, "dark"), ["light", "dark", "dark_dimmed"]);
  assert.deepEqual(coveredModes(MODE_INDEX, "light_colorblind"), ["light_colorblind", "dark_colorblind"]);
  assert.equal(seedFor(MODE_INDEX, { seedMode: null, policy: "native-unknown" }), null);
});
