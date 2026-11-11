// C9's check route, dispatched by scripts/check-routes.mjs to run({command, args, root, outDir}),
// which resolves to {exitCode, testCount}:
//   release      check:release: DONE.md's automated gate. Runs RELEASE_STEPS in order, stops at the
//                first failure, and writes artifacts/reports/release.json with each step's command,
//                exit code, test count and time, the steps it never reached, the toolchain and
//                release versions, the candidate commit and the hashes in artifacts/SHA256SUMS. It
//                makes no live GitHub request and starts no deploy or store submission.
//   budgets      check:budgets with no surface: ARCHITECTURE.md's release budgets, measured from
//                dist/, artifacts/ and a fresh bundle of content.js, then the site's own route
//                (budgets --surface=site) and the timings in artifacts/reports/release-timings.json.
//                Writes artifacts/reports/budgets.json. A measurement that is missing fails. Owned
//                DOM nodes and effects are check:effects' and fonts per file check:fonts'.
//   store-links  check:store-links: each store in release.config.json is null or a listing URL of
//                that store, and README.md and the site name no other listing. With --require-live
//                both listings must exist, and each is fetched.
//   test:e2e     The release surface, tests/e2e/release in release-chromium and release-firefox.
//                Its timing tests each write a file under artifacts/reports/release-timings (or
//                RESKIN_RELEASE_TIMINGS), which this clears first and then merges into
//                artifacts/reports/release-timings.json for check:budgets.
//   a11y         The release surface's @a11y tests: the add-on's pages at 320px in both engines.
//   qa-live      qa:live -- --read-only: scripts/qa-live.mjs, the live public GitHub check of the
//                packages in artifacts/. It needs the network and is not part of check:release.
//   qa-firefox   qa:firefox: scripts/qa-firefox.mjs, the Firefox package in an actual Firefox
//                release. It needs that Firefox and the network, and is not part of check:release.
//   qa-userscript qa:userscript: scripts/qa-userscript.mjs, the userscript in real Violentmonkey and
//                Tampermonkey, in Chromium and an actual Firefox release. It needs the network.
// capture-release and qa-published-install are not written yet and fail with exit 2.
// Direct use: node tests/release/checks.mjs <command> [args]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { cpus, tmpdir, totalmem } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { BROWSER_TARGETS, BUDGETS, LIMITS } from "../../packages/contracts/index.js";
import { runSurface } from "../../scripts/check-a11y.mjs";
import { artifactName } from "../../scripts/package.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPORTS = "artifacts/reports";

// DONE.md's table in its order, except that package runs before budgets, which measures its ZIPs.
// A step is a routed check or a build script that only writes files.
export const RELEASE_STEPS = Object.freeze([
  { command: "npm run check:toolchain", check: "toolchain" },
  { command: "npm test", check: "test" },
  { command: "npm run check:harness", check: "harness" },
  { command: "npm run check:schema", check: "schema" },
  { command: "npm run check:css", check: "css" },
  { command: "npm run check:themes", check: "themes" },
  { command: "npm run check:classic-themes", check: "classic-themes" },
  { command: "npm run check:prompt", check: "prompt" },
  { command: "npm run check:primer", check: "primer" },
  { command: "npm run check:contrast", check: "contrast" },
  { command: "npm run check:slot-contracts", check: "slot-contracts" },
  { command: "npm run check:migrations", check: "migrations" },
  { command: "npm run check:boot", check: "boot" },
  { command: "npm run check:fonts", check: "fonts" },
  { command: "npm run check:effects", check: "effects" },
  { command: "npm run build", script: ["scripts/build.mjs", "--target", "all"] },
  { command: "npm run check:userscript", check: "userscript" },
  { command: "npm run check:site", check: "site" },
  { command: "npm run test:e2e", check: "test:e2e" },
  { command: "npm run check:a11y", check: "a11y" },
  { command: "npm run lint:chrome", check: "lint-chrome" },
  { command: "npm run lint:firefox", check: "lint-firefox" },
  { command: "npm run package", script: ["scripts/package.mjs"] },
  { command: "npm run check:budgets", check: "budgets" },
  { command: "npm run check:artifacts", check: "artifacts" },
  { command: "npm run check:repro", check: "repro" },
]);

// One check as its own `node scripts/check.mjs` process, which writes {exitCode, testCount} to
// RESKIN_CHECK_RESULT. Importing the dispatcher here instead would wait on its own top-level await.
export function runCheck(root, command, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "reskin-check-"));
  const file = join(dir, "result.json");
  try {
    const child = spawnSync(process.execPath, ["scripts/check.mjs", command, ...args], { cwd: root, stdio: "inherit", env: { ...process.env, RESKIN_CHECK_RESULT: file } });
    const reported = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    return { exitCode: child.status || reported?.exitCode || (reported ? 0 : 1), testCount: reported?.testCount ?? 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function runStep(step, { root }) {
  if (step.check) return runCheck(root, step.check);
  const result = spawnSync(process.execPath, step.script, { cwd: root, stdio: "inherit" });
  return { exitCode: result.status ?? 1, testCount: 0 };
}

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

async function writeReport(root, name, report) {
  await mkdir(join(root, REPORTS), { recursive: true });
  await writeFile(join(root, REPORTS, name), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${REPORTS}/${name}`);
}

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function npmVersion() {
  const agent = process.env.npm_config_user_agent?.match(/^npm\/(\S+)/)?.[1];
  if (agent) return agent;
  const result = spawnSync("npm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * check:release. `steps` and `runStep` are for tests.
 * @returns {Promise<{exitCode:number, testCount:number}>}
 */
export async function checkRelease({ args = [], root, outDir = join(root, "dist"), steps = RELEASE_STEPS, run = runStep }) {
  if (args.length) {
    console.error(`check:release takes no arguments, got ${args.join(" ")}`);
    return { exitCode: 1, testCount: 0 };
  }
  const config = await readJson(join(root, "release.config.json"));
  const done = [];
  for (const step of steps) {
    console.log(`\n== ${step.command}`);
    const started = performance.now();
    const { exitCode, testCount } = await run(step, { root, outDir });
    done.push({ command: step.command, exitCode, testCount, seconds: Math.round(performance.now() - started) / 1000 });
    if (exitCode) break;
  }
  const failed = done.find((step) => step.exitCode);
  const exitCode = failed?.exitCode ?? 0;
  const testCount = done.reduce((n, step) => n + step.testCount, 0);
  const sums = join(root, "artifacts", "SHA256SUMS");
  const artifacts = existsSync(sums)
    ? Object.fromEntries(
        readFileSync(sums, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => line.split(/\s+/).reverse()),
      )
    : {};
  const playwright = await readJson(join(root, "node_modules", "@playwright", "test", "package.json")).catch(() => null);
  const commit = git(root, ["rev-parse", "HEAD"]);
  await writeReport(root, "release.json", {
    command: "npm run check:release",
    exitCode,
    testCount,
    candidate: { commit, clean: commit ? git(root, ["status", "--porcelain"]) === "" : null },
    versions: { release: config.version, node: process.versions.node, npm: npmVersion(), playwright: playwright?.version ?? null },
    steps: done,
    notRun: steps.slice(done.length).map((step) => step.command),
    artifacts,
  });
  console.log(`\ncheck:release: ${done.length} of ${steps.length} steps run, ${testCount} tests, ${failed ? `stopped at ${failed.command} (exit ${failed.exitCode})` : "all passed"}`);
  return { exitCode, testCount };
}

// Every file under dir, as [path relative to dir, bytes].
async function filesUnder(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.push([relative(dir, path).replaceAll("\\", "/"), (await stat(path)).size]);
  }
  return files;
}

const sum = (files) => files.reduce((n, [, bytes]) => n + bytes, 0);
const sizeOf = async (path) => (await stat(path).catch(() => null))?.size ?? null;

// ARCHITECTURE.md's content engine/bootstrap: content.js as the build bundles it, with the frozen
// mode data left out and everything else it carries, the catalog included. css-tree's chunk alone
// is minified, as THEME-EXPANSION.md measured it. Both gzip at level 9.
const NO_MODE_DATA = { name: "no-mode-data", setup: (build) => build.onLoad({ filter: /[\\/]vendor[\\/]primer[\\/]modes\.json$/ }, () => ({ contents: "export default {};", loader: "js" })) };

async function measureEngine(root) {
  const { build } = await import("esbuild");
  const { bundleFile } = await import("../../packages/ui/bundle.mjs");
  const size = (bytes) => ({ raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length });
  const parser = await build({
    stdin: { contents: 'export { parse, walk, generate, lexer, fork, tokenize, ident, clone, List, toPlainObject } from "css-tree/dist/csstree.esm";', resolveDir: root, loader: "js" },
    absWorkingDir: root,
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: ["chrome120", "firefox140"],
    minify: true,
    write: false,
    logLevel: "silent",
  });
  return { engine: size(await bundleFile(root, "content.js", { plugins: [NO_MODE_DATA] })), parser: size(parser.outputFiles[0].contents) };
}

// The browser-measured gates, as the release surface records them in release-timings.json:
// [name, key in that report, BUDGETS key, unit, whether the budget itself fails].
const TIMINGS = Object.freeze([
  ["preview resolve p95", "previewResolveP95Ms", "previewResolveP95Ms", "ms", false],
  ["settings to style p95", "settingsToStyleP95Ms", "settingsToStyleP95Ms", "ms", false],
  ["longest extension task", "longestTaskMs", "longTaskMs", "ms", true],
  ["idle CPU, 30 s", "idleCpuPercent", "idleCpuPercent", "% of one core", false],
]);

/**
 * check:budgets with no surface. `site` and `engine` are for tests.
 * @returns {Promise<{exitCode:number, testCount:number}>}
 */
export async function checkBudgets({ args = [], root, outDir = join(root, "dist"), site = () => runCheck(root, "budgets", ["--surface=site"]), engine = measureEngine }) {
  if (args.length) {
    console.error(`check:budgets without a surface takes no arguments, got ${args.join(" ")}. The site's budgets are --surface=site.`);
    return { exitCode: 1, testCount: 0 };
  }
  const config = await readJson(join(root, "release.config.json"));
  const measurements = [];
  const missing = [];
  // `below`: the budget itself fails, as for "no extension task >=50 ms".
  const measure = (name, actual, budget, unit = "bytes", below = false) => {
    if (actual === null || actual === undefined) missing.push(name);
    else measurements.push({ name, actual, budget, unit, ok: below ? actual < budget : actual <= budget });
  };

  for (const browser of BROWSER_TARGETS) {
    const zip = artifactName(config.version, browser);
    measure(zip, await sizeOf(join(root, "artifacts", zip)), BUDGETS.runtimeZipBytes);
    const unpacked = existsSync(join(outDir, browser)) ? sum(await filesUnder(join(outDir, browser))) : null;
    measure(`dist/${browser} unpacked`, unpacked, BUDGETS.unpackedRuntimeBytes);
  }
  const fonts = existsSync(join(outDir, "chrome", "assets", "fonts")) ? (await filesUnder(join(outDir, "chrome", "assets", "fonts"))).filter(([path]) => path.endsWith(".woff2")) : null;
  measure("bundled fonts (WOFF2)", fonts && sum(fonts), LIMITS.fontTotalWoff2Bytes);
  const { engine: bundle, parser } = await engine(root);
  measure("content script without mode data, raw", bundle.raw, BUDGETS.contentEngineRawBytes);
  measure("content script without mode data, gzip", bundle.gzip, BUDGETS.contentEngineGzipBytes);
  measure("CSS parser chunk, raw", parser.raw, BUDGETS.cssParserRawBytes);
  measure("CSS parser chunk, gzip", parser.gzip, BUDGETS.cssParserGzipBytes);
  measure("frozen mode data (vendor/primer/modes.json)", await sizeOf(join(root, "vendor", "primer", "modes.json")), BUDGETS.modeDataRawBytes);
  measure(`dist/userscript/${config.userscript.output}`, await sizeOf(join(outDir, "userscript", config.userscript.output)), BUDGETS.userscriptBytes);

  const timings = await readJson(join(root, REPORTS, "release-timings.json")).catch(() => ({}));
  for (const [name, key, budget, unit, below] of TIMINGS) measure(name, Number.isFinite(timings[key]) ? timings[key] : null, BUDGETS[budget], unit, below);

  console.log("\n== npm run check:budgets -- --surface=site");
  const siteResult = await site();
  const over = measurements.filter((m) => !m.ok);
  for (const m of measurements) console.log(`  ${m.ok ? "ok  " : "OVER"} ${m.name}: ${m.actual} of ${m.budget} ${m.unit}`);
  for (const name of missing) console.error(`  MISSING ${name}: not measured`);
  if (missing.some((name) => TIMINGS.some(([timing]) => timing === name))) console.error(`  The release surface (npm run test:e2e -- --surface=release) records the timings in ${REPORTS}/release-timings.json.`);
  if (missing.some((name) => !TIMINGS.some(([timing]) => timing === name))) console.error("  Package and build sizes need npm run build and npm run package first.");
  await writeReport(root, "budgets.json", {
    machine: { platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? null, cores: cpus().length, memoryBytes: totalmem(), node: process.versions.node },
    measurements,
    missing,
    site: { exitCode: siteResult.exitCode, testCount: siteResult.testCount, report: `${REPORTS}/site-budgets.json` },
    timings: timings.machine ? { machine: timings.machine, browsers: timings.browsers ?? null } : null,
  });
  const exitCode = over.length || missing.length || siteResult.exitCode ? 1 : 0;
  console.log(`check:budgets: ${measurements.length} measured, ${over.length} over, ${missing.length} missing, site exit ${siteResult.exitCode}`);
  return { exitCode, testCount: measurements.length + missing.length + siteResult.testCount };
}

// Where the release surface's timing tests write, as tests/e2e/release/helpers.mjs does.
const timingsDir = (root) => process.env.RESKIN_RELEASE_TIMINGS || join(root, REPORTS, "release-timings");

/**
 * release-timings.json from the timing tests' files, each {project, name, data}: the gates as
 * check:budgets reads them and every file's own numbers under `browsers`. The preview's resolve
 * and settings to style gate the slower engine, so each needs both; Firefox's settings to style
 * starts at the storage write (tests/e2e/release/timings.firefox.spec.mjs). The long task and idle
 * CPU come from Chromium's trace and metrics. Returns null when nothing was measured.
 */
export function mergeTimings(parts, measuredAt = new Date().toISOString()) {
  if (!parts.length) return null;
  const get = (project, name, key) => parts.find((part) => part.project === project && part.name === name)?.data[key];
  const slower = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? Math.max(a, b) : null);
  const browsers = {};
  for (const { project, name, data } of parts) {
    const { project: _project, machine: _machine, ...values } = data;
    (browsers[project] ??= {})[name] = values;
  }
  return {
    measuredAt,
    machine: parts[0].data.machine ?? null,
    previewResolveP95Ms: slower(get("release-chromium", "preview", "previewResolveP95Ms"), get("release-firefox", "preview", "previewResolveP95Ms")),
    settingsToStyleP95Ms: slower(get("release-chromium", "settings", "settingsToStyleP95Ms"), get("release-firefox", "storage", "storageToStyleP95Ms")),
    longestTaskMs: get("release-chromium", "settings", "longestTaskMs") ?? null,
    idleCpuPercent: get("release-chromium", "idle", "idleCpuPercent") ?? null,
    browsers,
  };
}

/**
 * The release surface's test:e2e, or its @a11y tests with `a11y`. test:e2e replaces
 * release-timings.json with what this run measured, even when a test fails, so check:budgets never
 * reads an earlier run's numbers. `runner` is for tests.
 * @returns {Promise<{exitCode:number, testCount:number}>}
 */
export async function releaseSurface({ args = [], root, a11y = false, runner = runSurface }) {
  if (a11y) return runner("release", { args, root, a11y: true });
  const dir = timingsDir(root);
  await rm(dir, { recursive: true, force: true });
  await rm(join(root, REPORTS, "release-timings.json"), { force: true });
  const result = await runner("release", { args, root });
  const parts = [];
  for (const file of existsSync(dir) ? (await readdir(dir)).sort() : []) {
    const match = file.match(/^(.+)\.([^.]+)\.json$/);
    if (match) parts.push({ project: match[1], name: match[2], data: await readJson(join(dir, file)) });
  }
  const timings = mergeTimings(parts);
  if (timings) await writeReport(root, "release-timings.json", timings);
  return result;
}

// A store's listing address: Chrome Web Store's detail page with its 32-letter ID, or addons.mozilla.org's.
export const STORE_URLS = Object.freeze({
  chrome: /^https:\/\/chromewebstore\.google\.com\/detail\/[a-z0-9-]+\/[a-p]{32}$/,
  firefox: /^https:\/\/addons\.mozilla\.org\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?firefox\/addon\/[a-z0-9-]+\/?$/,
});
const ANY_STORE_URL = /https?:\/\/(?:chromewebstore\.google\.com|chrome\.google\.com\/webstore|addons\.mozilla\.org)[^\s"'<>)\]]*/g;
const TEXT_FILE = /\.(md|mjs|js|astro|html|json|css|txt)$/;

/**
 * check:store-links. `fetchPage` is for tests.
 * @returns {Promise<{exitCode:number, testCount:number}>}
 */
export async function checkStoreLinks({ args = [], root, fetchPage = (url) => fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000) }) }) {
  const live = args.includes("--require-live");
  const unknown = args.filter((arg) => arg !== "--require-live");
  if (unknown.length) {
    console.error(`check:store-links takes only --require-live, got ${unknown.join(" ")}`);
    return { exitCode: 1, testCount: 0 };
  }
  const { stores, displayName } = await readJson(join(root, "release.config.json"));
  const failures = [];
  let count = 0;
  const check = (ok, message) => {
    count++;
    if (!ok) failures.push(message);
  };

  check(JSON.stringify(Object.keys(stores ?? {}).sort()) === JSON.stringify(Object.keys(STORE_URLS).sort()), `release.config.json stores must be exactly ${Object.keys(STORE_URLS).join(" and ")}`);
  for (const [store, pattern] of Object.entries(STORE_URLS)) {
    const url = stores?.[store] ?? null;
    check(url === null || (typeof url === "string" && pattern.test(url)), `stores.${store} is ${JSON.stringify(url)}, not null or a ${store} listing URL`);
    if (live) check(url !== null, `stores.${store} is null; --require-live needs the real listing`);
  }

  // Store links come only from release.config.json, through site/src/lib/site.mjs.
  const configured = new Set(Object.values(stores ?? {}).filter(Boolean));
  const sources = [["README.md", join(root, "README.md")]];
  for (const [path] of existsSync(join(root, "site", "src")) ? await filesUnder(join(root, "site", "src")) : []) if (TEXT_FILE.test(path)) sources.push([`site/src/${path}`, join(root, "site", "src", path)]);
  for (const [name, path] of sources) {
    const text = await readFile(path, "utf8").catch(() => "");
    const stray = [...text.matchAll(ANY_STORE_URL)].map(([url]) => url.replace(/[.,;:]+$/, "")).filter((url) => !configured.has(url));
    check(stray.length === 0, `${name} names a store listing release.config.json does not: ${[...new Set(stray)].join(", ")}`);
  }

  if (live) {
    for (const [store, url] of Object.entries(stores ?? {})) {
      if (!url) continue;
      let ok = false;
      let detail = "";
      try {
        const response = await fetchPage(url);
        const body = await response.text();
        ok = response.status === 200 && body.includes(displayName);
        detail = `HTTP ${response.status}${response.status === 200 && !ok ? `, no "${displayName}" on the page` : ""}`;
      } catch (error) {
        detail = String(error?.message ?? error);
      }
      check(ok, `${store} listing ${url}: ${detail}`);
    }
  }

  for (const failure of failures) console.error(`  FAIL ${failure}`);
  console.log(`check:store-links${live ? " --require-live" : ""}: ${count} checks, ${failures.length} failed`);
  return { exitCode: failures.length ? 1 : 0, testCount: count };
}

/** @type {import("../../packages/contracts/index.js").CheckRunner} */
export async function run({ command, args = [], root = DEFAULT_ROOT, outDir = join(root, "dist") }) {
  if (command === "release") return checkRelease({ args, root, outDir });
  if (command === "budgets") return checkBudgets({ args, root, outDir });
  if (command === "store-links") return checkStoreLinks({ args, root });
  if (command === "test:e2e") return releaseSurface({ args, root });
  if (command === "a11y") return releaseSurface({ args, root, a11y: true });
  if (command === "qa-live") return (await import("../../scripts/qa-live.mjs")).qaLive({ args, root });
  if (command === "qa-firefox") return (await import("../../scripts/qa-firefox.mjs")).qaFirefox({ args, root });
  if (command === "qa-userscript") return (await import("../../scripts/qa-userscript.mjs")).qaUserscript({ args, root });
  console.error(`NOT IMPLEMENTED: ${command} (owner C9): tests/release/checks.mjs does not serve it yet. Until it exists this gate fails.`);
  return { exitCode: 2, testCount: 0 };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = "release", ...args] = process.argv.slice(2);
  const result = await run({ command, args, root: DEFAULT_ROOT, outDir: join(DEFAULT_ROOT, "dist") });
  process.exit(result.exitCode);
}
