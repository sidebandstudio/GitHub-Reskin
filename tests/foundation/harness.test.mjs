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
import { BUILTIN, ROUTES, SURFACES, UNITS, optionValues, withoutOptions } from "../../scripts/check-routes.mjs";
import { dispatch } from "../../scripts/check.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

// Where each unit's check module may live.
const OWNED = {
  C1: ["scripts/check-a11y.mjs"],
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

test("every check the acceptance gates name has one owner and a module inside that owner's directories", () => {
  // Commands in DONE.md and WORKPLAN.md, without the npm prefixes.
  const named = [
    "test", "harness", "toolchain", "release", "schema", "themes", "classic-themes", "prompt", "primer", "contrast", "slot-contracts",
    "migrations", "boot", "fonts", "effects", "userscript", "site", "e2e", "a11y", "lint-chrome", "lint-firefox", "budgets",
    "store-links", "video", "render-video", "verify-video", "capture-release", "qa-live", "qa-firefox", "qa-userscript", "qa-published-install",
  ];
  const known = new Set([...BUILTIN, "e2e", "a11y", ...Object.keys(ROUTES)]);
  for (const name of named) assert.ok(known.has(name), name);
  for (const [command, routes] of Object.entries(ROUTES)) {
    assert.ok(routes.length > 0, command);
    assert.ok(!routes.at(-1).when, `${command}'s last route is its default`);
    for (const route of routes) {
      assert.ok(UNITS[route.owner], `${command}: ${route.owner}`);
      assert.ok(OWNED[route.owner].some((dir) => route.module === dir || route.module.startsWith(dir)), `${command}: ${route.module} is outside ${route.owner}'s directories`);
      assert.match(route.export, /^[a-z][A-Za-z]*$/, command);
    }
  }
  for (const [name, surface] of Object.entries(SURFACES)) {
    assert.ok(OWNED[surface.owner].some((dir) => surface.module === dir || surface.module.startsWith(dir)), name);
  }
  // The routes named in the coordinator's assignment.
  const owner = (command, args = []) => ROUTES[command].find(({ when = {} }) => Object.entries(when).every(([k, v]) => optionValues(args, k).includes(v))).owner;
  assert.deepEqual(
    ["schema", "prompt", "classic-themes"].map((c) => owner(c)),
    ["C2", "C2", "C2"],
  );
  assert.equal(owner("contrast", ["--scope=engine"]), "C2");
  assert.equal(owner("contrast", ["--scope=primer"]), "C3");
  assert.equal(owner("budgets", ["--surface=site"]), "C7");
  assert.equal(owner("budgets"), "C9");
  assert.deepEqual(["primer", "slot-contracts", "migrations", "boot", "fonts", "effects", "site", "userscript", "video", "release"].map((c) => owner(c)), [
    "C3", "C3", "C4", "C4", "C5", "C5", "C7", "C8", "C10", "C9",
  ]);
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

test("option parsing reads both --name=value and --name value, and removes them", () => {
  const args = ["--scope=engine", "--surface", "site", "--headed", "--project=a", "--project", "b"];
  assert.deepEqual(optionValues(args, "scope"), ["engine"]);
  assert.deepEqual(optionValues(args, "surface"), ["site"]);
  assert.deepEqual(optionValues(args, "project"), ["a", "b"]);
  assert.deepEqual(withoutOptions(args, ["project", "surface"]), ["--scope=engine", "--headed"]);
});

const routes = {
  schema: [{ owner: "C2", module: "format/checks.mjs", export: "schema" }],
  prompt: [{ owner: "C2", module: "format/checks.mjs", export: "prompt" }],
  silent: [{ owner: "C2", module: "format/checks.mjs", export: "silent" }],
  render: [{ owner: "C10", module: "format/checks.mjs", export: "silent", tests: false }],
  broken: [{ owner: "C2", module: "format/checks.mjs", export: "broken" }],
  throws: [{ owner: "C2", module: "format/checks.mjs", export: "throws" }],
  failing: [{ owner: "C2", module: "format/checks.mjs", export: "failing" }],
  contrast: [
    { when: { scope: "engine" }, owner: "C2", module: "format/checks.mjs", export: "engineContrast" },
    { owner: "C3", module: "primer/checks.mjs", export: "contrast" },
  ],
};
const MODULE = `
export const calls = (globalThis.calls ||= []);
const record = (name, result) => async (options) => (calls.push([name, options]), result);
export const schema = record("schema", { exitCode: 0, testCount: 4 });
export const silent = record("silent", { exitCode: 0, testCount: 0 });
export const broken = record("broken", { exitCode: "no" });
export const throws = async () => { throw new Error("boom"); };
export const failing = record("failing", { exitCode: 3, testCount: 2 });
export const engineContrast = record("engineContrast", { exitCode: 0, testCount: 9 });
`;

test("a route calls its unit's export with the command, forwarded arguments, root and report directory", async () => {
  await withModules({ "format/checks.mjs": MODULE }, async (root) => {
    globalThis.calls = [];
    const { result } = await quietly(() => dispatch("schema", ["--fixture", "a b", "--x=1"], { root, routes }));
    assert.deepEqual(result, { exitCode: 0, testCount: 4 });
    assert.deepEqual(globalThis.calls, [["schema", { command: "schema", args: ["--fixture", "a b", "--x=1"], root, outDir: join(root, "artifacts", "reports") }]]);
    assert.ok(existsSync(join(root, "artifacts", "reports")));

    // The first route whose selector matches wins; otherwise the default.
    globalThis.calls = [];
    const engine = await quietly(() => dispatch("contrast", ["--scope", "engine"], { root, routes }));
    assert.deepEqual(engine.result, { exitCode: 0, testCount: 9 });
    const primer = await quietly(() => dispatch("contrast", ["--scope=primer"], { root, routes }));
    assert.equal(primer.result.exitCode, 2);
    assert.match(primer.output, /NOT IMPLEMENTED: contrast \(owner C3\): primer\/checks\.mjs does not exist/);
  });
});

test("a missing module or export is NOT IMPLEMENTED with exit 2, and bad results fail", async () => {
  await withModules({ "format/checks.mjs": MODULE }, async (root) => {
    const cases = [
      ["prompt", 2, /NOT IMPLEMENTED: prompt \(owner C2\): format\/checks\.mjs has no export prompt/],
      ["silent", 1, /silent: format\/checks\.mjs silent\(\) ran no tests/],
      ["broken", 1, /returned \{"exitCode":"no"\}, not \{ exitCode, testCount \}/],
      ["throws", 1, /throws \(owner C2\) threw: Error: boom/],
      ["failing", 3, /^$/],
      ["nothing-here", 1, /Unknown check nothing-here/],
    ];
    for (const [command, exitCode, output] of cases) {
      const run = await quietly(() => dispatch(command, [], { root, routes }));
      assert.equal(run.result.exitCode, exitCode, command);
      assert.match(run.output, output, command);
    }
    // A command that produces files instead of running tests may report zero.
    assert.deepEqual((await quietly(() => dispatch("render", [], { root, routes }))).result, { exitCode: 0, testCount: 0 });
  });
  await withTempDir(async (root) => {
    const run = await quietly(() => dispatch("schema", [], { root, routes }));
    assert.equal(run.result.exitCode, 2);
    assert.match(run.output, /NOT IMPLEMENTED: schema \(owner C2\): format\/checks\.mjs does not exist/);
  });
});

const surfaces = {
  platform: { owner: "C1", module: "platform.mjs", projects: [["platform-chromium", "chromium"], ["platform-firefox", "firefox"]] },
  fixture: { owner: "C5", module: "fixture.mjs", projects: [["fixture-chromium", "chromium"], ["fixture-firefox", "firefox"]] },
  release: { owner: "C9", module: "release.mjs", projects: [["release-chromium", "chromium"]], a11y: false },
};
const SURFACE = (name) => `
const record = (kind) => async (options) => ((globalThis.calls ||= []).push(["${name}", kind, options.args]), { exitCode: 0, testCount: 2 });
export const e2e = record("e2e");
export const a11y = record("a11y");
`;

test("a11y dispatches each requested surface, or every accessibility surface, and rejects unknown ones", async () => {
  await withModules({ "platform.mjs": SURFACE("platform"), "release.mjs": SURFACE("release") }, async (root) => {
    globalThis.calls = [];
    const one = await quietly(() => dispatch("a11y", ["--surface=platform", "--headed"], { root, surfaces }));
    assert.deepEqual(one.result, { exitCode: 0, testCount: 2 });
    assert.deepEqual(globalThis.calls, [["platform", "a11y", ["--surface=platform", "--headed"]]]);

    // Without a selector every accessibility surface runs, so a missing one fails the command.
    globalThis.calls = [];
    const all = await quietly(() => dispatch("a11y", [], { root, surfaces }));
    assert.deepEqual(all.result, { exitCode: 2, testCount: 2 });
    assert.match(all.output, /NOT IMPLEMENTED: a11y --surface=fixture \(owner C5\): fixture\.mjs does not exist/);
    assert.deepEqual(globalThis.calls.map(([name]) => name), ["platform"], "release has no accessibility surface");

    for (const surface of ["release", "nowhere"]) {
      const bad = await quietly(() => dispatch("a11y", [`--surface=${surface}`], { root, surfaces }));
      assert.equal(bad.result.exitCode, 1, surface);
      assert.match(bad.output, /Unknown accessibility surface/);
    }
  });
});

test("e2e groups requested projects by surface, runs every surface without a selector, and rejects unknown projects", async () => {
  await withModules({ "platform.mjs": SURFACE("platform"), "fixture.mjs": SURFACE("fixture"), "release.mjs": SURFACE("release") }, async (root) => {
    globalThis.calls = [];
    const some = await quietly(() => dispatch("e2e", ["--project=fixture-firefox", "--workers=1", "--project", "platform-chromium"], { root, surfaces }));
    assert.deepEqual(some.result, { exitCode: 0, testCount: 4 });
    assert.deepEqual(globalThis.calls, [
      ["platform", "e2e", ["--project=platform-chromium", "--workers=1"]],
      ["fixture", "e2e", ["--project=fixture-firefox", "--workers=1"]],
    ]);
    globalThis.calls = [];
    await quietly(() => dispatch("e2e", [], { root, surfaces }));
    assert.deepEqual(globalThis.calls.map(([name, , args]) => [name, args.length]), [["platform", 2], ["fixture", 2], ["release", 1]]);
    const bad = await quietly(() => dispatch("e2e", ["--project=chromium"], { root, surfaces }));
    assert.equal(bad.result.exitCode, 1);
    assert.match(bad.output, /Unknown Playwright project chromium/);
  });
});

test("the real routes whose modules do not exist yet fail as NOT IMPLEMENTED with their owner", async () => {
  for (const [command, list] of Object.entries(ROUTES)) {
    for (const route of list) {
      if (existsSync(join(ROOT, route.module))) continue;
      const args = Object.entries(route.when || {}).map(([name, value]) => `--${name}=${value}`);
      const { result, output } = await quietly(() => dispatch(command, args));
      assert.equal(result.exitCode, 2, command);
      assert.match(output, new RegExp(`NOT IMPLEMENTED: ${command}.* \\(owner ${route.owner}\\)`), command);
    }
  }
  for (const [name, surface] of Object.entries(SURFACES)) {
    if (existsSync(join(ROOT, surface.module)) || surface.a11y === false) continue;
    const { result, output } = await quietly(() => dispatch("a11y", [`--surface=${name}`]));
    assert.equal(result.exitCode, 2, name);
    assert.match(output, new RegExp(`NOT IMPLEMENTED: a11y --surface=${name} \\(owner ${surface.owner}\\)`));
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
