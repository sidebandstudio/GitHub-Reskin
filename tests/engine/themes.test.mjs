// Every bundled catalog theme against every same-base synthetic seed. Today the catalog holds the
// twelve Classics; S1's anime documents join automatically when they are added to the catalog.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adversarialThemes, parseArgs, run } from "../../packages/engine/checks.mjs";
import { basePolarityIssue, graphProblems, repairTheme, resolveTheme } from "../../packages/engine/index.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const seeds = readdirSync(`${ROOT}tests/fixtures/seeds`).filter((f) => f.endsWith(".json")).map((f) => json(`${ROOT}tests/fixtures/seeds/${f}`));
const catalog = json(`${ROOT}themes/catalog.json`);
const themed = (seed) => ({ seed, policy: "themed", reducedMotion: false, forcedColors: false });

for (const entry of catalog) {
  test(`${entry.id} resolves readably on every same-base seed and is at its repair fixed point`, () => {
    const theme = json(`${ROOT}${entry.file}`);
    const matching = seeds.filter((s) => s.base === theme.base);
    assert.equal(matching.length, 2);
    for (const seed of matching) {
      const resolved = resolveTheme(theme, themed(seed));
      assert.deepEqual(resolved.pairAudit.filter((r) => !r.passed), [], seed.id);
      assert.deepEqual(graphProblems(resolved.graph, resolved.tokens.canvas, theme.base === "dark" ? "up" : "down"), [], seed.id);
      if (theme.contributions) assert.deepEqual(resolved.graph, theme.contributions.levels, `${seed.id}: supplied ramp kept`);
    }
    assert.deepEqual(repairTheme(theme, matching.find((s) => s.family === "standard")).repairs, []);
  });
}

test("the deterministic adversarial sweep passes every pair and graph rule", () => {
  const themes = adversarialThemes(60);
  assert.equal(JSON.stringify(adversarialThemes(60)), JSON.stringify(themes));
  let switched = 0;
  for (let theme of themes) {
    // A base the colors contradict is refused, then checked with the other base a person would choose.
    const conflict = basePolarityIssue(theme);
    if (conflict) {
      assert.throws(() => repairTheme(theme, seeds.find((s) => s.base === theme.base && s.family === "standard")), (error) => error.code === conflict.code, theme.name);
      theme = { ...theme, base: theme.base === "dark" ? "light" : "dark" };
      switched++;
    }
    const standard = seeds.find((s) => s.base === theme.base && s.family === "standard");
    const { theme: repaired } = repairTheme(theme, standard);
    assert.deepEqual(repairTheme(repaired, standard).repairs, [], theme.name);
    for (const source of [theme, repaired]) {
      for (const seed of seeds.filter((s) => s.base === theme.base)) {
        const resolved = resolveTheme(source, themed(seed));
        assert.deepEqual(resolved.pairAudit.filter((r) => !r.passed), [], `${theme.name} on ${seed.id}`);
        assert.deepEqual(graphProblems(resolved.graph, resolved.tokens.canvas, theme.base === "dark" ? "up" : "down"), [], `${theme.name} on ${seed.id}`);
      }
    }
  }
  assert.ok(switched > 0 && switched < themes.length, `${switched} of ${themes.length} sweep themes contradict their base`);
});

test("contrast scopes: primer and the full gate need C3's mode index; unknown scopes fail", async () => {
  assert.equal((await run({ command: "contrast", args: ["--scope=primer"], root: ROOT })).exitCode, 2);
  assert.equal((await run({ command: "contrast", args: ["--scope", "primer"], root: ROOT })).exitCode, 2);
  assert.equal((await run({ command: "contrast", args: [], root: ROOT })).exitCode, 2);
  assert.equal((await run({ command: "contrast", args: ["--scope=preview"], root: ROOT })).exitCode, 2);
  assert.equal((await run({ command: "nope", args: [], root: ROOT })).exitCode, 2);
});

test("contrast arguments are validated in full before any check runs", async () => {
  const bad = [
    ["--scope=engine", "--scope=primer", "--ignored-flag"],
    ["--scope=engine", "--scope=primer"],
    ["--scope=engine", "--scope", "engine"],
    ["--scope=engine", "--ignored-flag"],
    ["--scope=engine", "extra"],
    ["--scope"],
    ["--scope="],
    ["--scope", "--themes", "themes/classics"],
    ["--scope=engine", "--themes"],
    ["--scope=engine", "--themes", "themes/classics", "--themes=themes/anime"],
    ["--scope=engine", "--themes", "does/not/exist"],
    ["--scope=engine", "--themes", "themes/catalog.json"],
    ["--scope=engine", "--themes", "packages/contracts/../../scripts"],
    ["--Scope=engine"],
  ];
  for (const args of bad) {
    assert.ok(parseArgs(args, ROOT).error, JSON.stringify(args));
    assert.deepEqual(await run({ command: "contrast", args, root: ROOT }), { exitCode: 2, testCount: 0 }, JSON.stringify(args));
  }
  assert.deepEqual(parseArgs([], ROOT), {});
  assert.deepEqual(parseArgs(["--scope", "engine"], ROOT), { scope: "engine" });
  assert.deepEqual(parseArgs(["--themes=themes/classics", "--scope=primer"], ROOT), { scope: "primer", themes: join(ROOT, "themes/classics") });
});

test("--scope=primer runs every themed seed in a ModeIndex and the full gate requires 25 themes", async () => {
  const root = mkdtempSync(join(tmpdir(), "reskin-contrast-"));
  try {
    for (const path of ["themes", "tests/fixtures"]) cpSync(join(ROOT, path), join(root, path), { recursive: true });
    const modes = Object.fromEntries(seeds.map((s) => [s.id, s]));
    const highContrast = { ...seeds[0], id: "fixture.hc-dark", highContrast: true };
    modes[highContrast.id] = highContrast;
    mkdirSync(join(root, "vendor/primer"), { recursive: true });
    writeFileSync(join(root, "vendor/primer/modes.json"), JSON.stringify({ contractVersion: 1, modes, counterparts: [{ nativeMode: "dark", base: "dark", seedMode: seeds[0].id }], nativeCss: {} }));
    const primer = await run({ command: "contrast", args: ["--scope=primer"], root, outDir: join(root, "dist") });
    assert.equal(primer.exitCode, 0);
    assert.ok(primer.testCount > 500);
    const full = await run({ command: "contrast", args: [], root, outDir: join(root, "dist") });
    assert.equal(full.exitCode, 0, "the full gate passes with all 25 catalog themes");
    writeFileSync(join(root, "themes/catalog.json"), JSON.stringify(catalog.filter((e) => e.group === "classics")));
    const incomplete = await run({ command: "contrast", args: [], root, outDir: join(root, "dist") });
    assert.equal(incomplete.exitCode, 1, "the full gate rejects a catalog missing the Anime themes");
    writeFileSync(join(root, "vendor/primer/modes.json"), JSON.stringify({ contractVersion: 1, modes: { wrong: seeds[0] }, counterparts: [], nativeCss: {} }));
    assert.equal((await run({ command: "contrast", args: ["--scope=primer"], root })).exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("engine runtime sources are pure: no DOM, storage, network, clocks or randomness", () => {
  for (const file of readdirSync(`${ROOT}packages/engine`).filter((f) => f.endsWith(".js"))) {
    const source = readFileSync(`${ROOT}packages/engine/${file}`, "utf8");
    assert.doesNotMatch(source, /\beval\(|new Function|\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|chrome\.|browser\.|\bdocument\b|\bwindow\b|Math\.random|Date\.now|performance\.now|from "node:/, file);
  }
});
