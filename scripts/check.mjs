// Checks behind the npm scripts that are not builds. Run: node scripts/check.mjs <check> [args]
//   test [paths...]   node:test over *.test.mjs and test.mjs files. Fails if nothing is discovered, if any file
//                     or path has no tests, or on any failure, cancellation or skip.
//   toolchain         exact Node, npm and dependency versions; reports browsers and media tools.
//   lint-firefox      web-ext lint of a fresh dist/firefox build.
//   lint-chrome       Chrome manifest and package checks, then the unpacked package loaded in
//                     Playwright's Chromium against a local fixture page.
// Checks that later units own report NOT IMPLEMENTED and exit 2, so a gate never passes empty.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withTempDir } from "../tests/helpers/tmp.mjs";
import { ROOT, build, extensionManifest, loadReleaseConfig, manifestPaths, manifestProblems } from "./build.mjs";
import { serve } from "./serve.mjs";
import { remoteResourceProblems } from "./verify-artifacts.mjs";

// Who supplies each gate that does not exist yet.
const PENDING = {
  "test:e2e": "C5 and C6 add the Playwright projects; C9 owns tests/e2e",
  release: "C9 Release integration and final gates",
  schema: "C2 Shared format and color engine",
  themes: "C2, with Sol's S1 theme data",
  "classic-themes": "C2 Shared format and color engine",
  prompt: "C2 Shared format and color engine",
  primer: "C3 Primer and GitHub adapter",
  contrast: "C2 and C3",
  "slot-contracts": "C3 Primer and GitHub adapter",
  migrations: "C4 Settings and extension lifecycle",
  boot: "C4 Settings and extension lifecycle",
  fonts: "C5 Appearance and shared preview",
  effects: "C5 Appearance and shared preview",
  userscript: "C8 Userscript parity",
  site: "C7 Showcase site",
  a11y: "C6 and C7, final gate C9",
  budgets: "C9 Release integration and final gates",
  "store-links": "C9 Release integration and final gates",
  video: "C10 Hyperframes films",
  "render-video": "C10 Hyperframes films",
  "verify-video": "C10 Hyperframes films",
  "capture-release": "C9 Release integration and final gates",
  "qa-live": "C9 Release integration and final gates",
  "qa-firefox": "C9 Release integration and final gates",
  "qa-userscript": "C9 Release integration and final gates",
  "qa-published-install": "C9 Release integration and final gates",
};

// web-ext warnings the release accepts, each with its reason. Anything else fails lint:firefox.
const ACCEPTED_FIREFOX_WARNINGS = {
  // gecko_android stays out of the manifest until a real device passes, so the linter applies
  // the desktop minimum (140) to Android, where data_collection_permissions arrived in 142.
  KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION: "Android is not a declared target; gecko_android is omitted until device approval",
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
    return 1;
  }

  const { run } = await import("node:test");
  const { spec } = await import("node:test/reporters");
  const counts = Object.fromEntries(files.map((file) => [file, 0]));
  const totals = { pass: 0, fail: 0, skip: 0 };
  const stream = run({ files });
  const record = (outcome) => (event) => {
    if (event.details?.type === "suite") return;
    // A file with no tests, or one that fails to load, reports one entry named after itself.
    if (event.name !== event.file) counts[event.file] = (counts[event.file] || 0) + 1;
    totals[event.skip || event.todo ? "skip" : outcome]++;
  };
  stream.on("test:pass", record("pass"));
  stream.on("test:fail", record("fail"));
  await new Promise((done) => stream.compose(spec).on("end", done).pipe(process.stdout, { end: false }));

  const empty = files.filter((file) => !counts[file]);
  const tests = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\n${files.length} files, ${tests} tests: ${totals.pass} passed, ${totals.fail} failed, ${totals.skip} skipped`);
  for (const file of empty) console.error(`${relative(ROOT, file)} ran no tests`);
  if (totals.skip) console.error("Skipped or todo tests fail the run; remove or finish them.");
  return totals.fail || totals.skip || empty.length || !tests ? 1 : 0;
}

function version(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n")[0].trim();
  } catch {
    return null;
  }
}

async function checkToolchain() {
  const config = await loadReleaseConfig();
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  const problems = [];
  const npm = /\bnpm\/(\S+)/.exec(process.env.npm_config_user_agent || "")?.[1] ?? version("npm", ["--version"]);
  if (process.versions.node !== config.toolchain.node) problems.push(`Node ${process.versions.node}, pinned ${config.toolchain.node}`);
  if (npm !== config.toolchain.npm) problems.push(`npm ${npm}, pinned ${config.toolchain.npm}`);
  if (readFileSync(join(ROOT, ".node-version"), "utf8").trim() !== config.toolchain.node) problems.push(".node-version disagrees with release.config.json");
  for (const [name, pinned] of Object.entries(pkg.devDependencies)) {
    const installed = existsSync(join(ROOT, "node_modules", name, "package.json")) ? JSON.parse(readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8")).version : null;
    const locked = lock.packages[`node_modules/${name}`]?.version;
    if (!/^\d+\.\d+\.\d+$/.test(pinned)) problems.push(`${name} must be pinned to an exact version, not ${pinned}`);
    if (locked !== pinned || installed !== pinned) problems.push(`${name}: pinned ${pinned}, locked ${locked}, installed ${installed}; run npm ci`);
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
    return 1;
  }
  console.log("check:toolchain passed");
  return 0;
}

async function lintFirefox() {
  const { dir } = await build({ target: "firefox", outDir: "dist" });
  const webExt = join(ROOT, "node_modules/web-ext/bin/web-ext.js");
  const result = spawnSync(process.execPath, [webExt, "lint", "--source-dir", dir, "--output", "json", "--no-config-discovery"], {
    encoding: "utf8",
    env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
  });
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  const show = (m) => `${m.code}: ${m.message}${m.file ? ` (${m.file})` : ""}`;
  const unexpected = report.warnings.filter((w) => !ACCEPTED_FIREFOX_WARNINGS[w.code]);
  for (const w of report.warnings.filter((w) => ACCEPTED_FIREFOX_WARNINGS[w.code])) console.log(`accepted warning ${w.code}: ${ACCEPTED_FIREFOX_WARNINGS[w.code]}`);
  for (const n of report.notices) console.log(`notice ${show(n)}`);
  console.log(`web-ext lint: ${report.errors.length} errors, ${report.warnings.length} warnings, ${report.notices.length} notices`);
  if (report.errors.length || unexpected.length) {
    console.error(`lint:firefox failed:\n  ${[...report.errors, ...unexpected].map(show).join("\n  ")}`);
    return 1;
  }
  console.log("lint:firefox passed");
  return 0;
}

// A page with the attributes and graph cell the 1.1.0 content script themes.
const FIXTURE_PAGE = `<!doctype html>
<html lang="en" data-color-mode="dark" data-dark-theme="dark" data-light-theme="light">
<head><meta charset="utf-8"><title>Reskin fixture</title></head>
<body><main><h2>Fixture</h2><svg><rect class="ContributionCalendar-day" data-level="4" width="10" height="10"></rect></svg></main></body>
</html>
`;

async function lintChrome() {
  const config = await loadReleaseConfig();
  const { dir, files } = await build({ target: "chrome", outDir: "dist" });
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
  const contents = Object.fromEntries(await Promise.all(Object.keys(files).map(async (path) => [path, await readFile(join(dir, path))])));
  const problems = [
    ...manifestProblems(manifest, "chrome", config),
    ...manifestPaths(manifest).filter((path) => !files[path]).map((path) => `missing ${path}`),
    ...remoteResourceProblems(contents),
  ];
  if (JSON.stringify(manifest) !== JSON.stringify(await extensionManifest("chrome", config))) problems.push("manifest.json differs from extension/manifests");
  if (problems.length) {
    console.error(`lint:chrome failed:\n  ${problems.join("\n  ")}`);
    return 1;
  }
  console.log(`Chrome manifest and package: ${Object.keys(files).length} files, permissions ${manifest.permissions.join(", ")}, no Gecko keys`);

  // Load the package unpacked, with a test-only match for the local fixture origin.
  const { launchExtension } = await import("../tests/helpers/chromium-extension.mjs");
  return withTempDir(async (tmp) => {
    const test = await build({ target: "chrome", outDir: join(tmp, "dist"), releaseConfig: config, testFixture: { matches: ["http://127.0.0.1/*"] } });
    await mkdir(join(tmp, "site"));
    await writeFile(join(tmp, "site", "index.html"), FIXTURE_PAGE);
    const server = await serve({ root: join(tmp, "site"), host: "127.0.0.1" });
    const browser = await launchExtension(test.dir, join(tmp, "profile"));
    try {
      const page = await browser.context.newPage();
      await page.goto(server.url);
      await page.waitForFunction(() => document.getElementById("github-reskin")?.textContent.length > 0, null, { timeout: 10000 });
      const background = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bgColor-default").trim());
      // With nothing saved, 1.1.0 paints its default, Cyberpunk.
      if (background !== "#0a0a17") throw new Error(`the content script painted --bgColor-default ${background}, expected #0a0a17`);
      console.log(`Unpacked load in Chromium ${browser.version}: content script themed the fixture (--bgColor-default ${background}).`);
    } finally {
      await browser.close();
      await server.close();
    }
    console.log("lint:chrome passed");
    return 0;
  });
}

const CHECKS = { test: runTests, toolchain: checkToolchain, "lint-firefox": lintFirefox, "lint-chrome": lintChrome };

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, ...args] = process.argv.slice(2);
  if (Object.hasOwn(CHECKS, name)) {
    process.exitCode = await CHECKS[name](args);
  } else if (Object.hasOwn(PENDING, name)) {
    console.error(`NOT IMPLEMENTED: ${name} belongs to ${PENDING[name]}. Until it exists this gate fails.`);
    process.exitCode = 2;
  } else {
    console.error(`Unknown check ${name}. Checks: ${[...Object.keys(CHECKS), ...Object.keys(PENDING)].join(", ")}`);
    process.exitCode = 1;
  }
}
