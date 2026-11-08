// Checks behind the npm scripts that are not builds. Run: node scripts/check.mjs <check> [args]
// Every check is a route in scripts/check-routes.mjs to a module exporting
// run({ command, args, root, outDir }). C1's local implementations are this module's run:
//   test [paths...]   node:test over *.test.mjs and test.mjs files. Fails if nothing is discovered, if any file
//                     or path has no tests, or on any failed or skipped test, suite or hook.
//   harness           the runner smoke tests: tests/foundation/harness.test.mjs, then the platform Playwright
//                     projects in Chromium and Firefox through the same test:e2e and a11y dispatch other surfaces use.
//   toolchain         exact Node, npm and dependency versions; reports browsers and media tools.
//   lint-firefox      web-ext lint of a fresh firefox build, with one reviewed warning allowed.
//   lint-chrome       Chrome manifest and package checks, then the unpacked package loaded in
//                     Playwright's Chromium against the platform fixture app.
//   test:e2e, a11y    the platform surface, tests/e2e/platform.
// Until a routed module and its run export exist the check fails with exit 2 and NOT IMPLEMENTED,
// so a gate never passes empty.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOT, build, extensionManifest, loadReleaseConfig, manifestPaths, manifestProblems } from "./build.mjs";
import { runSurface } from "./check-a11y.mjs";
import { ROUTES, SURFACES, SURFACE_COMMANDS, optionValues, withoutOptions } from "./check-routes.mjs";
import { serve } from "./serve.mjs";
import { remoteResourceProblems } from "./verify-artifacts.mjs";

// The web-ext warnings lint:firefox accepts, each only for the manifest it was reviewed against.
// Any other warning, and any error, fails.
export const ACCEPTED_FIREFOX_WARNINGS = {
  KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION: {
    // The linter applies the desktop minimum, 140, to Android, where data_collection_permissions
    // arrived in 142. gecko_android stays out until a real device passes, and the minimum stays.
    reason: "desktop-only manifest: strict_min_version 140.0, data_collection_permissions required none, no gecko_android; Android is not a declared target until device approval",
    applies: (manifest) =>
      JSON.stringify(manifest.browser_specific_settings) ===
      JSON.stringify({ gecko: { id: "github-reskin@sideband.studio", strict_min_version: "140.0", data_collection_permissions: { required: ["none"] } } }),
  },
};

async function testFiles(dir, recursive) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory() && recursive && item.name !== "node_modules" && item.name !== "e2e") files.push(...(await testFiles(path, true)));
    // Node's own defaults include test.mjs, which holds the Action's tests.
    else if (item.isFile() && (item.name.endsWith(".test.mjs") || item.name === "test.mjs")) files.push(path);
  }
  return files.sort();
}

// Test files for the given paths, or for the root and tests/ (without tests/e2e) by default.
// Returns the first path that has none as `empty`.
export async function discoverTests(paths = []) {
  const groups = paths.length ? paths.map((path) => [path, resolve(path)]) : [["the repository root", ROOT], ["tests", join(ROOT, "tests")]];
  const files = [];
  for (const [label, path] of groups) {
    const found = !existsSync(path) ? [] : path.endsWith(".mjs") ? [path] : await testFiles(path, path !== ROOT);
    if (!found.length) return { files, empty: label };
    files.push(...found.map((file) => realpathSync(file)));
  }
  return { files };
}

async function runTests(paths) {
  const { files, empty: nothing } = await discoverTests(paths);
  if (nothing) {
    console.error(`No test files found in ${nothing}. A test command that discovers nothing fails.`);
    return { exitCode: 1, testCount: 0 };
  }

  const { run } = await import("node:test");
  const { spec } = await import("node:test/reporters");
  const counts = Object.fromEntries(files.map((file) => [file, 0]));
  const totals = { pass: 0, fail: 0, skip: 0 };
  const broken = [];
  const stream = run({ files });
  const record = (outcome) => (event) => {
    const skipped = event.skip || event.todo;
    if (event.details?.type === "suite") {
      // A suite fails on its own when a hook or its callback throws. A suite that fails only
      // because a test in it failed was counted with that test. Skipped and todo suites count
      // as skips. Passing suites are not tests.
      if (skipped) totals.skip++;
      else if (outcome === "fail" && event.details.error?.failureType !== "subtestsFailed") {
        totals.fail++;
        broken.push(`suite "${event.name}" in ${relative(ROOT, event.file)} failed (${event.details.error?.failureType ?? "error"})`);
      }
      return;
    }
    // A file with no tests, or one that fails to load or whose top-level hook throws, reports one
    // entry named after itself.
    if (event.name === event.file) {
      if (outcome === "fail") broken.push(`${relative(ROOT, event.file)} failed outside any test (${event.details?.error?.failureType ?? "error"})`);
    } else counts[event.file] = (counts[event.file] || 0) + 1;
    totals[skipped ? "skip" : outcome]++;
  };
  stream.on("test:pass", record("pass"));
  stream.on("test:fail", record("fail"));
  await new Promise((done) => stream.compose(spec).on("end", done).pipe(process.stdout, { end: false }));

  const empty = files.filter((file) => !counts[file]);
  const tests = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\n${files.length} files, ${tests} tests: ${totals.pass} passed, ${totals.fail} failed, ${totals.skip} skipped`);
  for (const problem of broken) console.error(problem);
  for (const file of empty) console.error(`${relative(ROOT, file)} ran no tests`);
  if (totals.skip) console.error("Skipped or todo tests and suites fail the run; remove or finish them.");
  return { exitCode: totals.fail || totals.skip || empty.length || !tests ? 1 : 0, testCount: tests };
}

function version(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n")[0].trim();
  } catch {
    return null;
  }
}

// A problem list that also counts how many assertions were made, for a check's testCount.
function assertions() {
  const problems = [];
  let count = 0;
  return {
    problems,
    get count() {
      return count;
    },
    expect(ok, problem) {
      count++;
      if (!ok) problems.push(problem);
    },
  };
}

async function checkToolchain() {
  const config = await loadReleaseConfig();
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const checks = assertions();
  const { problems, expect } = checks;
  const npm = /\bnpm\/(\S+)/.exec(process.env.npm_config_user_agent || "")?.[1] ?? version("npm", ["--version"]);
  expect(process.versions.node === config.toolchain.node, `Node ${process.versions.node}, pinned ${config.toolchain.node}`);
  expect(npm === config.toolchain.npm, `npm ${npm}, pinned ${config.toolchain.npm}`);
  expect(readFileSync(join(ROOT, ".node-version"), "utf8").trim() === config.toolchain.node, ".node-version disagrees with release.config.json");
  for (const [name, pinned] of Object.entries(pkg.devDependencies)) {
    const installed = existsSync(join(ROOT, "node_modules", name, "package.json")) ? JSON.parse(readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8")).version : null;
    const locked = lock.packages[`node_modules/${name}`]?.version;
    expect(/^\d+\.\d+\.\d+$/.test(pinned), `${name} must be pinned to an exact version, not ${pinned}`);
    expect(locked === pinned && installed === pinned, `${name}: pinned ${pinned}, locked ${locked}, installed ${installed}; run npm ci`);
    console.log(`  ${name} ${installed}`);
  }
  console.log(`Node ${process.versions.node}, npm ${npm}`);
  const { chromium, firefox } = await import("@playwright/test");
  for (const [name, browser] of [["chromium", chromium], ["firefox", firefox]]) {
    const path = browser.executablePath();
    console.log(`Playwright ${name}: ${existsSync(path) ? "installed" : "not installed (npx --no-install playwright install chromium firefox)"}`);
  }
  console.log(`ffprobe: ${version("ffprobe", ["-version"]) ?? "not found"} (pinned by C10)`);
  console.log("Hyperframes CLI: not pinned yet (C10)");
  if (problems.length) {
    console.error(`check:toolchain failed:\n  ${problems.join("\n  ")}`);
    return { exitCode: 1, testCount: checks.count };
  }
  console.log("check:toolchain passed");
  return { exitCode: 0, testCount: checks.count };
}

async function lintFirefox({ outDir }) {
  const { dir, manifest } = await build({ target: "firefox", outDir });
  const webExt = join(ROOT, "node_modules/web-ext/bin/web-ext.js");
  const result = spawnSync(process.execPath, [webExt, "lint", "--source-dir", dir, "--output", "json", "--no-config-discovery"], {
    encoding: "utf8",
    env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
  });
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  const show = (m) => `${m.code}: ${m.message}${m.file ? ` (${m.file})` : ""}`;
  const accepted = (w) => ACCEPTED_FIREFOX_WARNINGS[w.code]?.applies(manifest);
  const unexpected = report.warnings.filter((w) => !accepted(w));
  for (const w of report.warnings.filter(accepted)) console.log(`accepted warning ${w.code}: ${ACCEPTED_FIREFOX_WARNINGS[w.code].reason}`);
  for (const n of report.notices) console.log(`notice ${show(n)}`);
  console.log(`web-ext ${JSON.parse(readFileSync(join(ROOT, "node_modules/web-ext/package.json"), "utf8")).version} lint: ${report.errors.length} errors, ${report.warnings.length} warnings (${unexpected.length} unexpected), ${report.notices.length} notices`);
  // Assertions: no errors, no unexpected warning, and each warning checked against the accepted list.
  const testCount = 2 + report.warnings.length;
  if (report.errors.length || unexpected.length) {
    console.error(`lint:firefox failed:\n  ${[...report.errors, ...unexpected].map(show).join("\n  ")}`);
    return { exitCode: 1, testCount };
  }
  console.log("lint:firefox passed");
  return { exitCode: 0, testCount };
}

async function lintChrome({ outDir }) {
  const config = await loadReleaseConfig();
  const { dir, files } = await build({ target: "chrome", outDir });
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const contents = Object.fromEntries(await Promise.all(Object.keys(files).map(async (path) => [path, await readFile(join(dir, path))])));
  const paths = manifestPaths(manifest);
  const problems = [
    ...manifestProblems(manifest, "chrome", config),
    ...paths.filter((path) => !files[path]).map((path) => `missing ${path}`),
    ...remoteResourceProblems(contents),
  ];
  if (JSON.stringify(manifest) !== JSON.stringify(await extensionManifest("chrome", config))) problems.push("manifest.json differs from extension/manifests");
  // Assertions: the manifest rules, each manifest path, each file's resource scan, the manifest
  // source comparison and the unpacked load.
  const testCount = 3 + paths.length + Object.keys(files).length;
  if (problems.length) {
    console.error(`lint:chrome failed:\n  ${problems.join("\n  ")}`);
    return { exitCode: 1, testCount: testCount - 1 };
  }
  console.log(`Chrome manifest and package: ${Object.keys(files).length} files, permissions ${manifest.permissions.join(", ")}, no Gecko keys`);

  // Load the package unpacked, with a test-only match for the local fixture origin.
  const { launchTestExtension } = await import("../tests/helpers/browsers.mjs");
  const { expectThemedByLegacyDefault } = await import("../tests/helpers/platform.mjs");
  const server = await serve({ root: join(ROOT, "tests/fixture-app/platform"), host: "127.0.0.1" });
  const browser = await launchTestExtension({ releaseConfig: config });
  try {
    const page = await browser.context.newPage();
    await page.goto(server.url);
    const background = await expectThemedByLegacyDefault(page);
    console.log(`Unpacked load in Chromium ${browser.version}: content script themed the fixture (--bgColor-default ${background}).`);
  } finally {
    await browser.close();
    await server.close();
  }
  console.log("lint:chrome passed");
  return { exitCode: 0, testCount };
}

async function harness({ args, root, outDir }) {
  const steps = [
    ["runner and dispatch tests", () => runTests([join(ROOT, "tests/foundation/harness.test.mjs")])],
    ["platform e2e, Chromium and Firefox", () => dispatch("test:e2e", ["--surface=platform", ...args], { root, outDir })],
    ["platform accessibility", () => dispatch("a11y", ["--surface=platform", ...args], { root, outDir })],
  ];
  const results = [];
  for (const [label, step] of steps) results.push([label, await step()]);
  console.log("\ncheck:harness");
  for (const [label, { exitCode, testCount }] of results) console.log(`  ${exitCode ? "failed" : "passed"}  ${label}: ${testCount} tests`);
  return { exitCode: results.find(([, r]) => r.exitCode)?.[1].exitCode ?? 0, testCount: results.reduce((n, [, r]) => n + r.testCount, 0) };
}

// Checks that take no arguments reject any, as every module validates what it supports.
const noArgs = (check) => (options) => {
  if (options.args.length) throw new Error(`${options.command} takes no arguments, got ${options.args.join(" ")}`);
  return check(options);
};

const LOCAL = {
  test: ({ args }) => runTests(args),
  harness,
  toolchain: noArgs(checkToolchain),
  "lint-firefox": noArgs(lintFirefox),
  "lint-chrome": noArgs(lintChrome),
  "test:e2e": ({ args, root }) => runSurface("platform", { args, root }),
  a11y: ({ args, root }) => runSurface("platform", { args, root, a11y: true }),
};

/**
 * C1's local implementations, behind the same contract as every routed module.
 * @type {import("../packages/contracts/index.js").CheckRunner}
 */
export async function run(options) {
  if (!Object.hasOwn(LOCAL, options.command)) throw new Error(`scripts/check.mjs has no local check ${options.command}`);
  return LOCAL[options.command](options);
}

const notImplemented = (label, owner, why) => {
  console.error(`NOT IMPLEMENTED: ${label} (owner ${owner}): ${why}. Until it exists this gate fails.`);
  return { exitCode: 2, testCount: 0 };
};

// Calls one route's run and checks what it returns.
async function callRoute(label, route, { command, args, root, outDir, local }) {
  let runner = local;
  if (!route.local) {
    const path = join(root, route.module);
    if (!existsSync(path)) return notImplemented(label, route.owner, `${route.module} does not exist`);
    runner = (await import(pathToFileURL(path).href)).run;
    if (typeof runner !== "function") return notImplemented(label, route.owner, `${route.module} has no run export`);
  }
  let result;
  try {
    result = await runner({ command, args: [...args], root, outDir });
  } catch (error) {
    console.error(`${label} (owner ${route.owner}) threw: ${error?.stack ?? error}`);
    return { exitCode: 1, testCount: 0 };
  }
  const { exitCode, testCount } = result ?? {};
  if (!Number.isInteger(exitCode) || !Number.isInteger(testCount) || exitCode < 0 || testCount < 0) {
    console.error(`${label}: ${route.module} run() returned ${JSON.stringify(result)}, not { exitCode, testCount }`);
    return { exitCode: 1, testCount: 0 };
  }
  if (!exitCode && !testCount && route.tests !== false) {
    console.error(`${label}: ${route.module} run() ran no tests. A check that runs nothing fails.`);
    return { exitCode: 1, testCount: 0 };
  }
  return { exitCode, testCount };
}

// Runs several routes in order and combines them: the first failure's exit code, all tests counted.
async function callAll(calls, context) {
  const results = [];
  for (const [label, route, args] of calls) results.push([label, route, await callRoute(label, route, { ...context, args })]);
  const exitCode = results.find(([, , r]) => r.exitCode)?.[2].exitCode ?? 0;
  const testCount = results.reduce((n, [, , r]) => n + r.testCount, 0);
  if (calls.length > 1) {
    console.log(`\n${context.command}: ${calls.length} routes`);
    for (const [label, { owner }, r] of results) console.log(`  ${r.exitCode ? `failed (exit ${r.exitCode})` : "passed"}  ${label} (owner ${owner}): ${r.testCount} tests`);
    console.log(`  ${testCount} tests, exit ${exitCode}`);
  }
  return { exitCode, testCount };
}

// The surfaces a test:e2e or a11y request selects. --surface names surfaces and --project names
// projects, each selecting its surface; with both, they must agree. No selector selects all.
function selectSurfaces(args, surfaces) {
  const names = Object.keys(surfaces);
  const surfaceOf = (project) => names.find((name) => surfaces[name].projects.some(([p]) => p === project));
  const asked = optionValues(args, "surface");
  const projects = optionValues(args, "project");
  const unknownSurfaces = asked.filter((name) => !Object.hasOwn(surfaces, name));
  if (unknownSurfaces.length) return { error: `Unknown surface ${unknownSurfaces.join(", ")}. Surfaces: ${names.join(", ")}` };
  const unknownProjects = projects.filter((project) => !surfaceOf(project));
  if (unknownProjects.length) {
    return { error: `Unknown Playwright project ${unknownProjects.join(", ")}. Projects: ${Object.values(surfaces).flatMap((s) => s.projects.map(([p]) => p)).join(", ")}` };
  }
  const fromProjects = new Set(projects.map(surfaceOf));
  if (asked.length && projects.length) {
    const conflicts = [
      ...projects.filter((project) => !asked.includes(surfaceOf(project))).map((project) => `--project=${project} belongs to ${surfaceOf(project)}`),
      ...asked.filter((name) => !fromProjects.has(name)).map((name) => `--surface=${name} has none of the requested projects`),
    ];
    if (conflicts.length) return { error: `Conflicting selectors: ${conflicts.join("; ")}` };
  }
  const chosen = new Set([...asked, ...fromProjects]);
  return { names: chosen.size ? names.filter((name) => chosen.has(name)) : names, surfaceOf };
}

/**
 * Runs a check by its dispatcher key: one route, or for test:e2e and a11y each selected surface.
 * routes and surfaces default to scripts/check-routes.mjs, and local to this module's run;
 * tests pass their own.
 * @returns {Promise<import("../packages/contracts/index.js").CheckResult>}
 */
export async function dispatch(command, args = [], { root = ROOT, outDir = join(root, "dist"), routes = ROUTES, surfaces = SURFACES, local = run } = {}) {
  const context = { command, root: resolve(root), outDir: resolve(outDir), local };

  if (SURFACE_COMMANDS.includes(command)) {
    const { error, names, surfaceOf } = selectSurfaces(args, surfaces);
    if (error) {
      console.error(error);
      return { exitCode: 1, testCount: 0 };
    }
    // One surface gets the arguments unchanged. With several, each loses the others' selectors.
    const own = (name) => (names.length === 1 ? args : withoutOptions(args, ["surface", "project"], (option, value) => (option === "surface" ? value : surfaceOf(value)) === name));
    return callAll(names.map((name) => [`${command} --surface=${name}`, surfaces[name], own(name)]), context);
  }

  if (Object.hasOwn(routes, command)) {
    const route = routes[command].find(({ when = {} }) => Object.entries(when).every(([name, value]) => optionValues(args, name).includes(value)));
    const label = [command, ...Object.entries(route.when || {}).map(([name, value]) => `--${name}=${value}`)].join(" ");
    return callAll([[label, route, args]], context);
  }

  console.error(`Unknown check ${command}. Checks: ${[...SURFACE_COMMANDS, ...Object.keys(routes)].join(", ")}`);
  return { exitCode: 1, testCount: 0 };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, ...rest] = process.argv.slice(2);
  // npm removes its own "--"; one typed directly after the command is the same separator.
  const args = rest[0] === "--" ? rest.slice(1) : rest;
  const { exitCode } = await dispatch(name, args);
  process.exitCode = exitCode;
}
