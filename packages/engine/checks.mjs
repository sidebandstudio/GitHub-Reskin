// check:contrast, routed by scripts/check-routes.mjs to this module's run for every scope. run takes
// {command, args, root, outDir} and resolves to {exitCode, testCount}, where testCount counts
// individual assertions. Node only.
//   node packages/engine/checks.mjs contrast --scope=engine [--themes <dir>]
//   --scope=engine  the four synthetic seeds in tests/fixtures/seeds with every catalog theme, the
//                   round-trip, repair and valid fixtures and a deterministic adversarial sweep.
//   --scope=primer  every themed production seed in C3's vendor/primer/modes.json with the twelve
//                   Classics, the same fixtures and a shorter adversarial sweep.
//   no scope        the full gate: the engine scope, then all 25 catalog themes on every production
//                   seed. It needs the complete catalog.
// --themes <dir> adds the theme files in another directory, such as staged content.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogProblems, decodeShare, encodeShare, exportTheme, parseImport, validateTheme } from "../format/index.js";
import { graphProblems, rampDirection, repairTheme, resolveTheme, seedProblems } from "./index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, "../..");
const SEED_NAMES = ["standard-dark", "standard-light", "colorblind-dark", "tritanopia-light"];
const MODE_INDEX = "vendor/primer/modes.json";
const FIXTURE_DIRS = ["tests/fixtures/roundtrip", "tests/fixtures/schema/repair", "tests/fixtures/schema/valid"];
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const context = (seed) => ({ seed, policy: "themed", reducedMotion: false, forcedColors: false });

/** Deterministic adversarial themes: mid-grays, polarity-straddling overrides, collapsed graphs. */
export function adversarialThemes(count = 240) {
  let state = 0x2545f491;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  const hex = () => `#${Math.floor(next() * 0x1000000).toString(16).padStart(6, "0")}`;
  const gray = (lo = 0, hi = 255) => {
    const v = Math.floor(lo + next() * (hi - lo + 1)).toString(16).padStart(2, "0");
    return `#${v}${v}${v}`;
  };
  const themes = [];
  for (let i = 0; i < count; i++) {
    const base = i % 2 ? "light" : "dark";
    const mid = () => gray(0x60, 0x90);
    const pick = [hex, mid, gray][i % 3];
    const theme = { schemaVersion: 1, name: `Sweep ${i}`, base, colors: { background: pick(), text: pick(), accent: pick() } };
    if (i % 4 === 0) theme.colors.contribution = theme.colors.background;
    if (i % 5 < 3) {
      // Overrides on the opposite side of the background.
      theme.overrides = { surface: base === "dark" ? gray(0xd0, 0xff) : gray(0, 0x30), hover: hex(), mutedText: pick(), link: theme.colors.background, primaryBackground: mid(), primaryText: mid(), focus: theme.colors.background, selectionBackground: pick(), selectionText: pick(), success: pick(), danger: pick(), warning: pick(), done: pick(), syntax: { comment: pick(), keyword: pick() } };
    }
    if (i % 6 === 0) {
      const v = (n) => `#${n.toString(16).padStart(2, "0").repeat(3)}`;
      theme.contributions = { levels: [v(10), v(11), v(12), v(13), v(14)] };
    }
    themes.push(theme);
  }
  return themes;
}

function tally(label) {
  const failures = [];
  let count = 0;
  const check = (ok, message) => {
    count++;
    if (!ok) failures.push(message);
    return ok;
  };
  const done = (summary) => {
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    console.log(`${label}: ${summary}, ${count} checks, ${failures.length} failed`);
    return { exitCode: failures.length ? 1 : 0, testCount: count };
  };
  return { check, done };
}

const fileThemes = (root, entries) => entries.map((entry) => [entry.file, readJson(join(root, entry.file))]);
function fixtureThemes(root) {
  return FIXTURE_DIRS.flatMap((dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith(".reskin.json")).sort().map((f) => [`${dir}/${f}`, readJson(join(root, dir, f))]));
}
function extraThemes(root, args) {
  const at = args.indexOf("--themes");
  if (at < 0) return [];
  const dir = resolve(root, args[at + 1]);
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => [join(dir, f), readJson(join(dir, f))]);
}

// The production seeds from C3's mode index, or the reason it cannot be used.
function productionSeeds(root, check) {
  const path = join(root, MODE_INDEX);
  if (!existsSync(path)) return { missing: `${MODE_INDEX} (C3 Primer and GitHub adapter)` };
  const index = readJson(path);
  check(index.contractVersion === 1, `${MODE_INDEX} contractVersion must be 1`);
  const modes = Object.entries(index.modes ?? {});
  check(modes.length > 0, `${MODE_INDEX} has no modes`);
  for (const [id, seed] of modes) {
    check(seed.id === id, `${MODE_INDEX} mode ${id} carries id ${seed.id}`);
    const problems = seedProblems(seed);
    check(!problems.length, `${MODE_INDEX} mode ${id}: ${problems.slice(0, 3).join("; ")}`);
  }
  for (const counterpart of index.counterparts ?? []) check(Object.hasOwn(index.modes, counterpart.seedMode), `counterpart ${counterpart.nativeMode}/${counterpart.base} names missing seed ${counterpart.seedMode}`);
  return { seeds: modes.map(([, seed]) => seed).filter((seed) => !seed.highContrast) };
}

// Portable repair uses one standard seed per base: the mode whose ID is the base name, or the
// first standard mode by ID.
function standardSeeds(seeds) {
  const pick = (base) => {
    const standard = seeds.filter((s) => s.base === base && s.family === "standard").sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return standard.find((s) => s.id === base) ?? standard[0];
  };
  return { dark: pick("dark"), light: pick("light") };
}

function checkThemes(sources, seeds, check) {
  const standard = standardSeeds(seeds);
  for (const [label, theme] of sources) {
    if (!check(validateTheme(theme).ok, `${label} is not schema-valid`)) continue;
    if (!check(standard[theme.base], `no standard ${theme.base} seed for ${label}`)) continue;
    const { theme: repaired, repairs } = repairTheme(theme, standard[theme.base]);
    check(repairTheme(repaired, standard[theme.base]).repairs.length === 0, `${label}: source repair is not a fixed point`);
    // Export, share and reimport are byte-stable.
    const bytes = exportTheme(repaired).bytes;
    const reimported = parseImport(bytes, "file");
    check(reimported.ok && Buffer.from(exportTheme(reimported.normalized).bytes).equals(Buffer.from(bytes)), `${label}: JSON export is not stable`);
    const code = encodeShare(repaired);
    const decoded = decodeShare(code);
    check(decoded.ok && encodeShare(repairTheme(decoded.normalized, standard[theme.base]).theme) === code, `${label}: RS1 round trip is not stable`);
    for (const seed of seeds.filter((s) => s.base === theme.base)) {
      const resolved = resolveTheme(repaired, context(seed));
      const failed = resolved.pairAudit.filter((r) => !r.passed);
      check(!failed.length, `${label} on ${seed.id}: ${failed.slice(0, 4).map((r) => `${r.id}@${r.background} ${r.ratio.toFixed(3)}`).join(", ")}`);
      const graph = graphProblems(resolved.graph, resolved.tokens.canvas, rampDirection(theme.base, resolved.tokens.canvas));
      check(!graph.length, `${label} on ${seed.id}: ${graph.join("; ")}`);
      if (theme.contributions && !repairs.some((r) => r.path === "/contributions/levels")) check(JSON.stringify(resolved.graph) === JSON.stringify(theme.contributions.levels.map((c) => c.toLowerCase())), `${label} on ${seed.id}: a valid supplied ramp changed`);
      check(JSON.stringify(resolveTheme(repaired, context(seed))) === JSON.stringify(resolved), `${label} on ${seed.id}: resolution is not deterministic`);
    }
  }
}

function engineScope(root, args) {
  const { check, done } = tally("check:contrast --scope=engine");
  const seeds = SEED_NAMES.map((name) => readJson(join(root, "tests/fixtures/seeds", `${name}.json`)));
  const sources = [...fileThemes(root, readJson(join(root, "themes/catalog.json"))), ...fixtureThemes(root), ...extraThemes(root, args), ...adversarialThemes().map((t) => [t.name, t])];
  checkThemes(sources, seeds, check);
  return done(`${sources.length} themes on ${seeds.length} synthetic seeds`);
}

function notImplemented(scope, missing) {
  console.error(`NOT IMPLEMENTED: check:contrast${scope ? ` --scope=${scope}` : ""} needs ${missing}.`);
  return { exitCode: 2, testCount: 0 };
}

function primerScope(root, args) {
  const { check, done } = tally("check:contrast --scope=primer");
  const { seeds, missing } = productionSeeds(root, check);
  if (missing) return notImplemented("primer", missing);
  const classics = readJson(join(root, "themes/catalog.json")).filter((e) => e.group === "classics");
  check(classics.length === 12, `the catalog has ${classics.length} Classics; 12 are required`);
  const sources = [...fileThemes(root, classics), ...fixtureThemes(root), ...extraThemes(root, args), ...adversarialThemes(60).map((t) => [t.name, t])];
  checkThemes(sources, seeds, check);
  return done(`${sources.length} themes on ${seeds.length} production seeds`);
}

function fullGate(root, args) {
  const { check, done } = tally("check:contrast");
  const { seeds, missing } = productionSeeds(root, check);
  if (missing) return notImplemented("", missing);
  const engine = engineScope(root, args);
  const catalog = readJson(join(root, "themes/catalog.json"));
  for (const problem of catalogProblems(catalog)) check(false, `catalog: ${problem}`);
  const counts = { anime: catalog.filter((e) => e.group === "anime").length, classics: catalog.filter((e) => e.group === "classics").length };
  check(counts.anime === 13 && counts.classics === 12, `the full gate needs 13 anime and 12 Classics; the catalog has ${counts.anime} and ${counts.classics}`);
  const sources = fileThemes(root, catalog);
  checkThemes(sources, seeds, check);
  const result = done(`${sources.length} catalog themes on ${seeds.length} production seeds`);
  return { exitCode: engine.exitCode || result.exitCode, testCount: engine.testCount + result.testCount };
}

/** @param {{command:string, args?:string[], root?:string, outDir?:string}} options */
export async function run({ command, args = [], root = DEFAULT_ROOT }) {
  if (command !== "contrast") {
    console.error(`packages/engine/checks.mjs has no ${command} check. Checks: contrast`);
    return { exitCode: 2, testCount: 0 };
  }
  const at = args.indexOf("--scope");
  const scope = at >= 0 ? args[at + 1] : args.find((a) => a.startsWith("--scope="))?.slice("--scope=".length);
  if (scope === "engine") return engineScope(root, args);
  if (scope === "primer") return primerScope(root, args);
  if (scope === undefined) return fullGate(root, args);
  console.error(`check:contrast has no scope ${scope}. Scopes: engine, primer, or none for the full gate.`);
  return { exitCode: 2, testCount: 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [command, ...args] = process.argv.slice(2);
  const { exitCode } = await run({ command, args, root: process.cwd() });
  process.exitCode = exitCode;
}
