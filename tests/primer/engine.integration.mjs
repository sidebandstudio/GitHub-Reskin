// Production modes through the real C2 engine: every frozen seed, every reviewed mode, the twelve
// Classics, C2's round-trip/repair/valid fixtures and its deterministic adversarial sweep.
// check:primer runs this file. It needs packages/engine (merged C2) or RESKIN_ENGINE_ROOT and
// fails without either; it is not named *.test.mjs so engine-free runs do not discover it.
import assert from "node:assert/strict";
import test from "node:test";
import { compileGitHub, contrast, emittedColors, MODE_INDEX, NOTICES, seedFor, selectMode, standardSeed } from "../../packages/primer/index.js";
import { at, loadEngine, PREFS, readJson } from "./helpers.mjs";

const { engine, pairs, classics, adversarial, fixtures } = await loadEngine();
const mappings = readJson("packages/primer/mappings.json");
const MODES = Object.values(MODE_INDEX.modes);
const nativeFor = (mode) => ({ colorMode: mode.base, lightTheme: mode.base === "light" ? mode.id : "light", darkTheme: mode.base === "dark" ? mode.id : "dark", systemDark: false });
const context = (plan, extra = {}) => ({ seed: seedFor(MODE_INDEX, plan), policy: plan.policy, reducedMotion: false, forcedColors: false, ...extra });
const sources = [
  ...classics.map(({ id, theme }) => ({ id, theme, strict: true })),
  ...fixtures.map(({ id, theme }) => ({ id, theme, strict: true })),
  ...adversarial.map((theme) => ({ id: theme.name, theme, strict: false })),
];

test("every production seed passes the engine's own ModeSeed validation", () => {
  assert.equal(classics.length, 12, "twelve Classics");
  for (const seed of MODES) assert.deepEqual(engine.seedProblems(seed), [], seed.id);
});

test("the mapping's pair IDs are the C2 matrix's records for each role", () => {
  assert.deepEqual(engine.pairMatrixProblems(pairs), []);
  const ids = new Set(pairs.records.map((r) => r.id));
  for (const [role, coverage] of Object.entries(mappings.rolePairs)) {
    for (const id of coverage.pairs) {
      assert.ok(ids.has(id), `${role}: ${id} exists`);
      const r = pairs.records.find((x) => x.id === id);
      assert.ok(r.foreground === role || r.backgrounds.includes(role), `${role}: ${id} involves it`);
    }
    const expected = pairs.records.filter((r) => r.foreground === role || r.backgrounds.includes(role)).map((r) => r.id);
    assert.deepEqual(coverage.pairs, expected, role);
  }
});

test("every reviewed mode with every Classic and fixture resolves readably, and its compiled stylesheet keeps GitHub's own pairings readable", () => {
  let resolutions = 0;
  const flagged = [];
  for (const { id, theme: original, strict } of sources) {
    // As in C2's contrast check, bundled and fixture themes must agree with their base, and a
    // generated sweep theme that contradicts its base continues with the other one.
    let theme = original;
    const conflict = engine.basePolarityIssue?.(theme);
    if (conflict) {
      assert.ok(!strict, `${id}: ${conflict.message}`);
      theme = { ...theme, base: theme.base === "dark" ? "light" : "dark" };
    }
    const source = engine.repairTheme(theme, standardSeed(MODE_INDEX, theme.base)).theme;
    for (const mode of MODES) {
      const plan = selectMode(nativeFor(mode), theme.base, MODE_INDEX);
      if (mode.highContrast) {
        assert.equal(plan.policy, "native-high-contrast", `${id} ${mode.id}`);
        const resolved = engine.resolveTheme(source, context(plan));
        assert.equal(resolved.tokens, null);
        assert.equal(compileGitHub(resolved, plan, PREFS).css, "");
        continue;
      }
      const resolved = engine.resolveTheme(source, context(plan));
      resolutions++;
      const failed = resolved.pairAudit.filter((r) => !r.passed);
      assert.deepEqual(failed.map((r) => `${r.id}@${r.background} ${r.ratio.toFixed(2)}`), [], `${id} on ${mode.id}`);
      // Syntax, ANSI and diff text on every code and diff background are matrix pairs.
      assert.ok(resolved.pairAudit.filter((r) => /^(syntax|ansi)\.|^diff/.test(r.id)).length >= 23 * 6 + 4, `${id} code pairs audited`);
      assert.deepEqual(engine.graphProblems(resolved.graph, resolved.tokens.canvas, engine.rampDirection(theme.base, resolved.tokens.canvas)), [], `${id} on ${mode.id} graph`);
      const out = compileGitHub(resolved, plan, PREFS);
      const values = new Map([...emittedColors(resolved, mappings.emit), ...emittedColors(resolved, mappings.brandFooter)]);
      // Every seasonal ramp is the resolved ramp, level for level.
      for (const season of ["default", "halloween", "winter"]) for (let n = season === "default" ? 0 : 1; n < 5; n++) assert.equal(values.get(`--contribution-${season}-bgColor-${n}`), resolved.graph[n]);
      for (const p of mappings.inheritedPairs) {
        for (const bg of p.backgrounds) {
          const ratio = contrast(values.get(p.foreground), values.get(bg));
          if (ratio >= p.minimum) continue;
          // A miss is allowed only for the pending page-syntax matrix request, never silently.
          const reported = out.warnings.some((w) => w.severity === "warning" && w.message.startsWith(`${p.foreground} uses`));
          assert.ok(!strict && p.id.startsWith("github.page.") && reported, `${id} on ${mode.id}: ${p.id} ${p.foreground} on ${bg} is ${ratio.toFixed(2)}`);
          flagged.push(`${id}/${mode.id} ${p.foreground}`);
        }
      }
    }
  }
  assert.ok(resolutions >= (classics.length + fixtures.length) * 7, `${resolutions} themed resolutions`);
  if (flagged.length) console.log(`  page-syntax pairs flagged for the pending C2 matrix request: ${flagged.length} (${[...new Set(flagged.map((f) => f.split("/")[0]))].join(", ")})`);
});

test("colorblind and tritanopia keep their seed's status colors over a theme's overrides", () => {
  const theme = { schemaVersion: 1, name: "Override test", base: "dark", colors: { background: "#101418", text: "#e8eef4", accent: "#4aa8ff" }, overrides: { success: "#7cff4a", danger: "#ff4a7c" } };
  for (const id of ["light_colorblind", "dark_colorblind", "light_tritanopia", "dark_tritanopia"]) {
    const plan = selectMode(nativeFor(MODE_INDEX.modes[id]), "dark", MODE_INDEX);
    assert.equal(plan.notice, NOTICES.accessibility);
    const resolved = engine.resolveTheme(theme, context(plan));
    assert.notEqual(resolved.semantics.success.text, "#7cff4a", id);
    assert.notEqual(resolved.semantics.danger.text, "#ff4a7c", id);
    const values = emittedColors(resolved);
    assert.equal(values.get("--fgColor-success"), resolved.semantics.success.text);
    assert.equal(values.get("--diffBlob-additionLine-bgColor"), resolved.tokens.diffAddedBackground);
  }
  // The same theme in a standard mode keeps its readable override.
  const standard = engine.resolveTheme(theme, context(selectMode(nativeFor(MODE_INDEX.modes.dark), "dark", MODE_INDEX)));
  assert.equal(standard.semantics.success.text, "#7cff4a");
});

test("forced colors and native policies resolve to the null branch and compile to nothing", () => {
  const theme = classics[0].theme;
  const plan = selectMode(nativeFor(MODE_INDEX.modes[theme.base]), theme.base, MODE_INDEX);
  const forced = engine.resolveTheme(theme, context(plan, { forcedColors: true }));
  assert.equal(forced.policy, "forced-colors");
  assert.equal(compileGitHub(forced, plan, PREFS).css, "");
  const unknown = selectMode({ colorMode: "dark", lightTheme: "light", darkTheme: "dark_sepia", systemDark: true }, theme.base, MODE_INDEX);
  const native = engine.resolveTheme(theme, context(unknown));
  assert.equal(native.policy, "native-unknown");
  assert.equal(compileGitHub(native, unknown, PREFS).css, "");
});

test("compiled values are the resolved roles, so a resolution and its stylesheet agree", () => {
  for (const { theme } of classics) {
    const plan = selectMode(nativeFor(MODE_INDEX.modes[theme.base]), theme.base, MODE_INDEX);
    const resolved = engine.resolveTheme(engine.repairTheme(theme, standardSeed(MODE_INDEX, theme.base)).theme, context(plan));
    const values = emittedColors(resolved);
    for (const entry of mappings.emit.filter((e) => !e.readableWith && !e.readableOn)) assert.equal(values.get(entry.variable), at(resolved, entry.role), entry.variable);
  }
});
