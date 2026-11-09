// The check router and the Playwright surface runner, without launching a browser. check:harness
// runs this file, then the platform projects in Chromium and Firefox.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import config from "../../playwright.config.mjs";
import { ROOT } from "../../scripts/build.mjs";
import { runPlaywright } from "../../scripts/check-a11y.mjs";
import { ROUTES, SURFACES, SURFACE_COMMANDS, UNITS, optionValues, withoutOptions } from "../../scripts/check-routes.mjs";
import { dispatch } from "../../scripts/check.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

// Where each unit's check module may live.
const OWNED = {
  C1: ["scripts/check.mjs", "scripts/verify-artifacts.mjs", "scripts/verify-repro.mjs"],
  C2: ["packages/format/", "packages/engine/"],
  C3: ["packages/primer/"],
  C4: ["packages/settings/"],
  C5: ["packages/appearance/"],
  C6: ["packages/ui/"],
  C7: ["site/"],
  C8: ["userscript/"],
  C9: ["tests/release/"],
  C10: ["scripts/verify-video.mjs"],
};

// Runs fn with console output captured, so expected failures stay out of the test log.
async function quietly(fn) {
  const lines = [];
  const { log, error } = console;
  console.log = console.error = (...args) => lines.push(args.join(" "));
  try {
    return { result: await fn(), output: lines.join("\n") };
  } finally {
    Object.assign(console, { log, error });
  }
}

// A temporary root with check modules written into it.
async function withModules(modules, fn) {
  return withTempDir(async (root) => {
    for (const [path, source] of Object.entries(modules)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), source);
    }
    return fn(root);
  });
}

// The route a command and arguments select in the real table.
const routeOf = (command, args = []) => ROUTES[command].find(({ when = {} }) => Object.entries(when).every(([k, v]) => optionValues(args, k).includes(v)));

test("every check has one owner and the module the revision 3 routing table names", () => {
  // WORKPLAN.md's static routes: dispatcher key, owner, module.
  const table = {
    toolchain: ["C1", "scripts/check.mjs"], harness: ["C1", "scripts/check.mjs"], test: ["C1", "scripts/check.mjs"],
    "lint-chrome": ["C1", "scripts/check.mjs"], "lint-firefox": ["C1", "scripts/check.mjs"],
    artifacts: ["C1", "scripts/verify-artifacts.mjs"], repro: ["C1", "scripts/verify-repro.mjs"],
    schema: ["C2", "packages/format/checks.mjs"], prompt: ["C2", "packages/format/checks.mjs"],
    // Revision 4 adds check:css to the same static format route.
    css: ["C2", "packages/format/checks.mjs"],
    themes: ["C2", "packages/format/checks.mjs"], "classic-themes": ["C2", "packages/format/checks.mjs"],
    contrast: ["C2", "packages/engine/checks.mjs"],
    primer: ["C3", "packages/primer/checks.mjs"], "slot-contracts": ["C3", "packages/primer/checks.mjs"],
    migrations: ["C4", "packages/settings/checks.mjs"], boot: ["C4", "packages/settings/checks.mjs"],
    fonts: ["C5", "packages/appearance/checks.mjs"], effects: ["C5", "packages/appearance/checks.mjs"],
    site: ["C7", "site/checks.mjs"], budgets: ["C9", "tests/release/checks.mjs"], userscript: ["C8", "userscript/checks.mjs"],
    video: ["C10", "scripts/verify-video.mjs"], "render-video": ["C10", "scripts/verify-video.mjs"], "verify-video": ["C10", "scripts/verify-video.mjs"],
    release: ["C9", "tests/release/checks.mjs"], "store-links": ["C9", "tests/release/checks.mjs"],
    "capture-release": ["C9", "tests/release/checks.mjs"], "qa-live": ["C9", "tests/release/checks.mjs"], "qa-firefox": ["C9", "tests/release/checks.mjs"],
    "qa-userscript": ["C9", "tests/release/checks.mjs"], "qa-published-install": ["C9", "tests/release/checks.mjs"],
  };
  assert.deepEqual(Object.keys(ROUTES).sort(), Object.keys(table).sort());
  for (const [command, [owner, module]] of Object.entries(table)) {
    const route = routeOf(command);
    assert.deepEqual([route.owner, route.module], [owner, module], command);
  }
  // Every contrast scope goes to C2's engine checks; only the site budget surface goes to C7.
  for (const args of [[], ["--scope=engine"], ["--scope", "primer"], ["--scope=full"]]) assert.deepEqual([routeOf("contrast", args).owner, routeOf("contrast", args).module], ["C2", "packages/engine/checks.mjs"], args.join(" "));
  assert.deepEqual([routeOf("budgets", ["--surface=site"]).owner, routeOf("budgets", ["--surface", "site"]).module], ["C7", "site/checks.mjs"]);
  // Only render and capture commands may report zero tests.
  assert.deepEqual(Object.keys(ROUTES).filter((command) => ROUTES[command].some((route) => route.tests === false)), ["render-video", "capture-release"]);

  for (const [command, routes] of Object.entries(ROUTES)) {
    assert.ok(!routes.at(-1).when, `${command}'s last route is its default`);
    for (const route of routes) {
      assert.ok(UNITS[route.owner], `${command}: ${route.owner}`);
      assert.ok(OWNED[route.owner].some((dir) => route.module === dir || route.module.startsWith(dir)), `${command}: ${route.module} is outside ${route.owner}'s directories`);
      assert.ok(!("export" in route), `${command}: every module exports run`);
      assert.equal(route.local === true, route.module === "scripts/check.mjs", command);
    }
  }

  assert.deepEqual(SURFACE_COMMANDS, ["test:e2e", "a11y"]);
  const surfaceTable = {
    platform: ["C1", "scripts/check.mjs"], fixture: ["C5", "packages/appearance/checks.mjs"], extension: ["C6", "packages/ui/checks.mjs"],
    site: ["C7", "site/checks.mjs"], userscript: ["C8", "userscript/checks.mjs"], release: ["C9", "tests/release/checks.mjs"],
  };
  assert.deepEqual(Object.fromEntries(Object.entries(SURFACES).map(([name, s]) => [name, [s.owner, s.module]])), surfaceTable);
  for (const [name, surface] of Object.entries(SURFACES)) {
    assert.ok(OWNED[surface.owner].some((dir) => surface.module === dir || surface.module.startsWith(dir)), name);
    assert.ok(!("a11y" in surface), `${name} is a required accessibility surface`);
  }
});

test("the Playwright config has the required projects, each surface in its own directory", () => {
  const projects = Object.fromEntries(config.projects.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(projects), [
    "platform-chromium", "platform-firefox", "fixture-chromium", "fixture-firefox", "chromium-extension",
    "site-chromium", "site-firefox", "userscript-chromium", "userscript-firefox", "release-chromium", "release-firefox",
  ]);
  for (const [name, project] of Object.entries(projects)) {
    const browser = name.includes("firefox") ? "firefox" : "chromium";
    assert.equal(project.use.browserName, browser, name);
    assert.equal(project.testIgnore, browser === "chromium" ? "**/*.firefox.spec.mjs" : "**/*.chromium.spec.mjs", name);
  }
  const dirs = Object.entries(SURFACES).map(([surface, { projects: list }]) => new Set(list.map(([name]) => projects[name].testDir)));
  for (const set of dirs) assert.equal(set.size, 1);
  assert.equal(new Set(dirs.map((set) => [...set][0])).size, dirs.length, "surfaces never share a test directory");
  assert.equal(config.testMatch, "**/*.spec.mjs");
  assert.equal(config.retries, 0);
  assert.equal(config.forbidOnly, true);
  assert.ok(existsSync(join(ROOT, "tests/e2e/platform")));
});

test("option parsing reads both --name=value and --name value, and removes them in order", () => {
  const args = ["--scope=engine", "--surface", "site", "--headed", "--project=a", "--project", "b"];
  assert.deepEqual(optionValues(args, "scope"), ["engine"]);
  assert.deepEqual(optionValues(args, "surface"), ["site"]);
  assert.deepEqual(optionValues(args, "project"), ["a", "b"]);
  assert.deepEqual(withoutOptions(args, ["project", "surface"]), ["--scope=engine", "--headed"]);
  assert.deepEqual(withoutOptions(args, ["project", "surface"], (name, value) => value === "b" || value === "site"), ["--scope=engine", "--surface", "site", "--headed", "--project", "b"]);
  assert.deepEqual(withoutOptions(["--x", "--project"], ["project"]), ["--x", "--project"], "a trailing flag without a value stays");
});

// A stub unit module implementing the common contract. Its result depends on the command.
const MODULE = `
export async function run(options) {
  (globalThis.calls ||= []).push(options);
  switch (options.command) {
    case "silent": case "render": return { exitCode: 0, testCount: 0 };
    case "broken": return { exitCode: "no" };
    case "negative": return { exitCode: 0, testCount: -1 };
    case "fractional": return { exitCode: 0, testCount: 1.5 };
    case "throws": throw new Error("boom");
    case "failing": return { exitCode: 3, testCount: 2 };
    case "contrast": return { exitCode: 0, testCount: 9 };
    default: return { exitCode: 0, testCount: 4 };
  }
}
`;
// The shape the previous router used: a named export per command and no run.
const NAMED = `export const schema = async () => ({ exitCode: 0, testCount: 4 });\n`;
const route = (owner, module, extra = {}) => [{ owner, module, ...extra }];
const routes = {
  schema: route("C2", "format/checks.mjs"),
  silent: route("C2", "format/checks.mjs"),
  render: route("C10", "format/checks.mjs", { tests: false }),
  broken: route("C2", "format/checks.mjs"),
  negative: route("C2", "format/checks.mjs"),
  fractional: route("C2", "format/checks.mjs"),
  throws: route("C2", "format/checks.mjs"),
  failing: route("C2", "format/checks.mjs"),
  named: route("C2", "named/checks.mjs"),
  missing: route("C4", "settings/checks.mjs"),
  local: route("C1", "scripts/check.mjs", { local: true }),
};

test("a route calls its module's run with the command key, the arguments unchanged, the root and the build-output root", async () => {
  await withModules({ "format/checks.mjs": MODULE }, async (root) => {
    globalThis.calls = [];
    const args = ["--fixture", "a b", "--x=1", "--scope", "primer", "--require-live", "--read-only"];
    const { result } = await quietly(() => dispatch("schema", args, { root, routes }));
    assert.deepEqual(result, { exitCode: 0, testCount: 4 });
    assert.deepEqual(globalThis.calls, [{ command: "schema", args, root, outDir: join(root, "dist") }]);
    assert.notEqual(globalThis.calls[0].args, args, "the module gets its own copy");

    globalThis.calls = [];
    await quietly(() => dispatch("schema", [], { root, routes, outDir: join(root, "elsewhere") }));
    assert.equal(globalThis.calls[0].outDir, join(root, "elsewhere"));

    // C1's own checks go through the same contract.
    const local = [];
    const own = await quietly(() => dispatch("local", ["--a"], { root, routes, local: async (options) => (local.push(options), { exitCode: 0, testCount: 7 }) }));
    assert.deepEqual(own.result, { exitCode: 0, testCount: 7 });
    assert.deepEqual(local, [{ command: "local", args: ["--a"], root, outDir: join(root, "dist") }]);
  });
});

test("a missing module or run export is NOT IMPLEMENTED with exit 2; failures, zero tests and bad results fail", async () => {
  await withModules({ "format/checks.mjs": MODULE, "named/checks.mjs": NAMED }, async (root) => {
    const cases = [
      ["missing", 2, /NOT IMPLEMENTED: missing \(owner C4\): settings\/checks\.mjs does not exist/],
      ["named", 2, /NOT IMPLEMENTED: named \(owner C2\): named\/checks\.mjs has no run export/],
      ["silent", 1, /silent: format\/checks\.mjs run\(\) ran no tests/],
      ["broken", 1, /returned \{"exitCode":"no"\}, not \{ exitCode, testCount \}/],
      ["negative", 1, /returned \{"exitCode":0,"testCount":-1\}/],
      ["fractional", 1, /returned \{"exitCode":0,"testCount":1\.5\}/],
      ["throws", 1, /throws \(owner C2\) threw: Error: boom/],
      ["failing", 3, /^$/],
      ["nothing-here", 1, /Unknown check nothing-here/],
      ["e2e", 1, /Unknown check e2e/],
    ];
    for (const [command, exitCode, output] of cases) {
      const run = await quietly(() => dispatch(command, [], { root, routes }));
      assert.equal(run.result.exitCode, exitCode, command);
      assert.match(run.output, output, command);
    }
    assert.deepEqual((await quietly(() => dispatch("failing", [], { root, routes }))).result, { exitCode: 3, testCount: 2 });
    // A command that produces files instead of running tests may report zero.
    assert.deepEqual((await quietly(() => dispatch("render", [], { root, routes }))).result, { exitCode: 0, testCount: 0 });
  });
});

test("the real table sends every contrast scope to C2's engine module and themes to C2's format module", async () => {
  await withModules({ "packages/engine/checks.mjs": MODULE, "packages/format/checks.mjs": MODULE, "packages/primer/checks.mjs": NAMED }, async (root) => {
    for (const args of [[], ["--scope=engine"], ["--scope", "primer"]]) {
      globalThis.calls = [];
      const { result } = await quietly(() => dispatch("contrast", args, { root }));
      assert.deepEqual(result, { exitCode: 0, testCount: 9 }, args.join(" "));
      assert.deepEqual(globalThis.calls, [{ command: "contrast", args, root, outDir: join(root, "dist") }]);
    }
    globalThis.calls = [];
    assert.deepEqual((await quietly(() => dispatch("themes", ["--x"], { root }))).result, { exitCode: 0, testCount: 4 });
    assert.deepEqual(globalThis.calls.map((c) => [c.command, c.args]), [["themes", ["--x"]]]);
    // C3's module, even with a named contrast-style export, is not consulted.
    const primer = await quietly(() => dispatch("primer", [], { root }));
    assert.equal(primer.result.exitCode, 2);
    assert.match(primer.output, /NOT IMPLEMENTED: primer \(owner C3\): packages\/primer\/checks\.mjs has no run export/);
  });
});

const surfaces = {
  platform: { owner: "C1", module: "platform.mjs", projects: [["platform-chromium", "chromium"], ["platform-firefox", "firefox"]] },
  fixture: { owner: "C5", module: "fixture.mjs", projects: [["fixture-chromium", "chromium"], ["fixture-firefox", "firefox"]] },
  release: { owner: "C9", module: "release.mjs", projects: [["release-chromium", "chromium"]] },
};
const SURFACE = (name, testCount = 2) => `
export async function run({ command, args }) {
  (globalThis.calls ||= []).push(["${name}", command, args]);
  return { exitCode: 0, testCount: ${testCount} };
}
`;

test("a11y and test:e2e select surfaces by --surface or --project, forward arguments unchanged, and run every surface without a selector", async () => {
  await withModules({ "platform.mjs": SURFACE("platform"), "release.mjs": SURFACE("release") }, async (root) => {
    for (const command of SURFACE_COMMANDS) {
      globalThis.calls = [];
      const one = await quietly(() => dispatch(command, ["--surface=platform", "--headed"], { root, surfaces }));
      assert.deepEqual(one.result, { exitCode: 0, testCount: 2 }, command);
      assert.deepEqual(globalThis.calls, [["platform", command, ["--surface=platform", "--headed"]]]);

      // A project selects its surface only.
      globalThis.calls = [];
      await quietly(() => dispatch(command, ["--headed", "--project", "platform-chromium"], { root, surfaces }));
      assert.deepEqual(globalThis.calls, [["platform", command, ["--headed", "--project", "platform-chromium"]]]);

      // Agreeing selectors.
      globalThis.calls = [];
      await quietly(() => dispatch(command, ["--project=release-chromium", "--surface=release"], { root, surfaces }));
      assert.deepEqual(globalThis.calls, [["release", command, ["--project=release-chromium", "--surface=release"]]]);

      // No selector: every surface, release included, so a missing one fails the command.
      globalThis.calls = [];
      const all = await quietly(() => dispatch(command, ["--workers=1"], { root, surfaces }));
      assert.deepEqual(all.result, { exitCode: 2, testCount: 4 }, command);
      assert.match(all.output, new RegExp(`NOT IMPLEMENTED: ${command} --surface=fixture \\(owner C5\\): fixture\\.mjs does not exist`));
      assert.match(all.output, new RegExp(`passed {2}${command} --surface=release \\(owner C9\\): 2 tests`));
      assert.deepEqual(globalThis.calls, [["platform", command, ["--workers=1"]], ["release", command, ["--workers=1"]]]);
    }
  });
});

test("a request spanning surfaces gives each only its own selectors, in order", async () => {
  await withModules({ "platform.mjs": SURFACE("platform"), "fixture.mjs": SURFACE("fixture") }, async (root) => {
    globalThis.calls = [];
    const some = await quietly(() => dispatch("test:e2e", ["--project=fixture-firefox", "--workers=1", "--project", "platform-chromium"], { root, surfaces }));
    assert.deepEqual(some.result, { exitCode: 0, testCount: 4 });
    assert.deepEqual(globalThis.calls, [
      ["platform", "test:e2e", ["--workers=1", "--project", "platform-chromium"]],
      ["fixture", "test:e2e", ["--project=fixture-firefox", "--workers=1"]],
    ]);
    globalThis.calls = [];
    await quietly(() => dispatch("a11y", ["--surface=fixture", "--surface", "platform", "--grep=x"], { root, surfaces }));
    assert.deepEqual(globalThis.calls, [
      ["platform", "a11y", ["--surface", "platform", "--grep=x"]],
      ["fixture", "a11y", ["--surface=fixture", "--grep=x"]],
    ]);
  });
});

test("unknown and conflicting selectors fail before any surface runs, and a surface with zero tests fails", async () => {
  await withModules({ "platform.mjs": SURFACE("platform"), "fixture.mjs": SURFACE("fixture", 0) }, async (root) => {
    const cases = [
      [["--surface=nowhere"], /Unknown surface nowhere/],
      [["--project=chromium"], /Unknown Playwright project chromium/],
      [["--surface=platform", "--project=fixture-chromium"], /Conflicting selectors: --project=fixture-chromium belongs to fixture; --surface=platform has none of the requested projects/],
      [["--surface=platform", "--surface=fixture", "--project=platform-chromium"], /Conflicting selectors: --surface=fixture has none of the requested projects/],
    ];
    for (const command of SURFACE_COMMANDS) {
      for (const [args, why] of cases) {
        globalThis.calls = [];
        const bad = await quietly(() => dispatch(command, args, { root, surfaces }));
        assert.deepEqual(bad.result, { exitCode: 1, testCount: 0 }, `${command} ${args.join(" ")}`);
        assert.match(bad.output, why);
        assert.deepEqual(globalThis.calls, []);
      }
      const empty = await quietly(() => dispatch(command, ["--surface=fixture"], { root, surfaces }));
      assert.deepEqual(empty.result, { exitCode: 1, testCount: 0 });
      assert.match(empty.output, new RegExp(`${command} --surface=fixture: fixture\\.mjs run\\(\\) ran no tests`));
    }
  });
});

test("the real routes and surfaces whose modules do not exist yet fail as NOT IMPLEMENTED with their owner and path", async () => {
  for (const [command, list] of Object.entries(ROUTES)) {
    for (const route of list) {
      if (route.local || existsSync(join(ROOT, route.module))) continue;
      const args = Object.entries(route.when || {}).map(([name, value]) => `--${name}=${value}`);
      const { result, output } = await quietly(() => dispatch(command, args));
      assert.equal(result.exitCode, 2, command);
      assert.match(output, new RegExp(`NOT IMPLEMENTED: ${command}.* \\(owner ${route.owner}\\): ${route.module.replaceAll(".", "\\.")} does not exist`), command);
    }
  }
  for (const [name, surface] of Object.entries(SURFACES)) {
    if (surface.local || existsSync(join(ROOT, surface.module))) continue;
    for (const command of SURFACE_COMMANDS) {
      const { result, output } = await quietly(() => dispatch(command, [`--surface=${name}`]));
      assert.equal(result.exitCode, 2, `${command} ${name}`);
      assert.match(output, new RegExp(`NOT IMPLEMENTED: ${command} --surface=${name} \\(owner ${surface.owner}\\)`));
    }
  }
});

// A Playwright project directory outside the repository, with the installed packages linked in.
async function withPlaywrightProjects(specs, fn) {
  return withTempDir(async (dir) => {
    await symlink(join(ROOT, "node_modules"), join(dir, "node_modules"), "junction");
    const names = Object.keys(specs);
    for (const name of names) {
      await mkdir(join(dir, name));
      if (specs[name]) await writeFile(join(dir, name, "probe.spec.mjs"), `import { test, expect } from "@playwright/test";\n${specs[name]}\n`);
    }
    const projects = names.map((name) => `{ name: ${JSON.stringify(name)}, testDir: ${JSON.stringify(`./${name}`)} }`).join(", ");
    await writeFile(join(dir, "playwright.config.mjs"), `export default { testMatch: "**/*.spec.mjs", retries: 0, projects: [${projects}] };\n`);
    return fn(dir, join(dir, "playwright.config.mjs"));
  });
}

test("the Playwright runner fails on zero discovered tests, unknown projects, skips and failures", async () => {
  // These tests use no page, so Playwright never launches a browser.
  const passes = `test("passes", { tag: "@a11y" }, () => expect(1).toBe(1));`;
  await withPlaywrightProjects(
    { good: passes, empty: null, skips: `${passes}\ntest("skipped", () => test.skip());`, fails: `${passes}\ntest("fails", () => expect(1).toBe(2));`, fixme: `${passes}\ntest.fixme("later", () => {});` },
    async (root, config) => {
      const run = (projects, grep) => quietly(() => runPlaywright({ projects, grep, root, config }));
      assert.deepEqual((await run(["good"])).result, { exitCode: 0, testCount: 1 });
      assert.deepEqual((await run(["good"], "@a11y")).result, { exitCode: 0, testCount: 1 });

      const empty = await run(["good", "empty"]);
      assert.deepEqual(empty.result, { exitCode: 1, testCount: 0 });
      assert.match(empty.output, /empty discovered no tests/);
      const unmatched = await run(["good"], "@nothing");
      assert.equal(unmatched.result.exitCode, 1);
      assert.match(unmatched.output, /good discovered no tests matching @nothing/);
      const unknown = await run(["good", "missing"]);
      assert.equal(unknown.result.exitCode, 1);
      assert.match(unknown.output, /Project\(s\) "missing" not found/);

      for (const [project, why] of [["skips", /skipped: skipped/], ["fixme", /later: skipped/], ["fails", /fails: unexpected/]]) {
        const bad = await run([project]);
        assert.equal(bad.result.exitCode, 1, project);
        assert.match(bad.output, why, project);
      }
    },
  );
});
