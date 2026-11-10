// tests/release/checks.mjs against throwaway roots: check:release runs its steps in order, stops at
// the first failure and reports every step, run or not; check:budgets measures what the build and
// package wrote, fails on a byte over or a measurement missing, and writes what it measured;
// check:store-links accepts null or real listing URLs only, finds stray listings in the README and
// site, and with --require-live needs both listings to answer.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { BUDGETS } from "../../packages/contracts/index.js";
import { fileURLToPath } from "node:url";
import { checkBudgets, checkRelease, checkStoreLinks, runCheck } from "./checks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const CONFIG = { version: "9.9.9", displayName: "GitHub Reskin", userscript: { output: "github-reskin.user.js" }, stores: { chrome: null, firefox: null } };
const CHROME = "https://chromewebstore.google.com/detail/github-reskin/abcdefghijklmnopabcdefghijklmnop";
const FIREFOX = "https://addons.mozilla.org/en-US/firefox/addon/github-reskin/";

async function withRoot(files, use) {
  const root = mkdtempSync(join(tmpdir(), "reskin-release-"));
  try {
    for (const [path, contents] of Object.entries({ "release.config.json": JSON.stringify(CONFIG), ...files })) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), contents);
    }
    return await use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const report = async (root, name) => JSON.parse(await readFile(join(root, "artifacts", "reports", name), "utf8"));
const quiet = async (fn) => {
  const { log, error } = console;
  console.log = console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { log, error });
  }
};

test("check:release runs its steps in order, stops at the first failure and reports the rest as not run", async () => {
  await withRoot({ "artifacts/SHA256SUMS": "aaa  github-reskin-9.9.9-chrome.zip\nbbb  build-info.json\n" }, async (root) => {
    const ran = [];
    const steps = [{ command: "npm test" }, { command: "npm run check:schema" }, { command: "npm run check:repro" }];
    const results = { "npm test": { exitCode: 0, testCount: 7 }, "npm run check:schema": { exitCode: 1, testCount: 2 } };
    const result = await quiet(() => checkRelease({ root, steps, run: async (step) => (ran.push(step.command), results[step.command]) }));
    assert.deepEqual(result, { exitCode: 1, testCount: 9 });
    assert.deepEqual(ran, ["npm test", "npm run check:schema"]);
    const written = await report(root, "release.json");
    assert.equal(written.exitCode, 1);
    assert.deepEqual(
      written.steps.map(({ command, exitCode, testCount }) => [command, exitCode, testCount]),
      [
        ["npm test", 0, 7],
        ["npm run check:schema", 1, 2],
      ],
    );
    assert.deepEqual(written.notRun, ["npm run check:repro"]);
    assert.deepEqual(written.artifacts, { "github-reskin-9.9.9-chrome.zip": "aaa", "build-info.json": "bbb" });
    assert.equal(written.versions.release, "9.9.9");
    assert.equal(written.versions.node, process.versions.node);
    assert.ok("commit" in written.candidate && "clean" in written.candidate);

    const passed = await quiet(() => checkRelease({ root, steps, run: async () => ({ exitCode: 0, testCount: 1 }) }));
    assert.deepEqual(passed, { exitCode: 0, testCount: 3 });
    assert.deepEqual((await report(root, "release.json")).notRun, []);
    assert.equal((await quiet(() => checkRelease({ root, args: ["--fast"], steps, run: async () => ({ exitCode: 0, testCount: 1 }) }))).exitCode, 1);
  });
});

test("a release step runs as its own check process and keeps that check's exit code and test count", () => {
  const passed = runCheck(ROOT, "store-links");
  assert.equal(passed.exitCode, 0);
  assert.ok(passed.testCount > 2, JSON.stringify(passed));
  assert.deepEqual(runCheck(ROOT, "store-links", ["--fast"]), { exitCode: 1, testCount: 0 });
  assert.deepEqual(runCheck(ROOT, "qa-live"), { exitCode: 2, testCount: 0 });
  assert.deepEqual(runCheck(ROOT, "no-such-check"), { exitCode: 1, testCount: 0 });
});

test("the real release steps cover DONE.md's gate, with package before budgets", async () => {
  const { RELEASE_STEPS } = await import("./checks.mjs");
  const commands = RELEASE_STEPS.map((step) => step.command);
  for (const command of ["npm test", "npm run check:harness", "npm run check:css", "npm run build", "npm run check:userscript", "npm run check:site", "npm run test:e2e", "npm run check:a11y", "npm run lint:chrome", "npm run lint:firefox", "npm run check:budgets", "npm run package", "npm run check:artifacts", "npm run check:repro"]) {
    assert.ok(commands.includes(command), command);
  }
  assert.ok(commands.indexOf("npm run package") < commands.indexOf("npm run check:budgets"));
  assert.ok(!commands.some((command) => /qa:|capture:|release|video/.test(command)), "no live, capture, video or recursive step");
});

const BUILT = {
  "artifacts/github-reskin-9.9.9-chrome.zip": "zip",
  "artifacts/github-reskin-9.9.9-firefox.zip": "zip",
  "dist/chrome/content.js": "x".repeat(100),
  "dist/chrome/assets/fonts/a/a.woff2": "f".repeat(40),
  "dist/firefox/content.js": "x".repeat(100),
  "dist/userscript/github-reskin.user.js": "u".repeat(30),
  "vendor/primer/modes.json": "{}",
};
const TIMINGS = JSON.stringify({ previewResolveP95Ms: 4.2, settingsToStyleP95Ms: 21, longestTaskMs: 12, idleCpuPercent: 0.2, machine: { cpu: "test" } });
const engine = async () => ({ engine: { raw: 1000, gzip: 400 }, parser: { raw: 500, gzip: 200 } });
const site = async () => ({ exitCode: 0, testCount: 4 });

test("check:budgets measures the package, fonts, engine, mode data and userscript, and needs the release timings", async () => {
  await withRoot(BUILT, async (root) => {
    const missing = await quiet(() => checkBudgets({ root, site, engine }));
    assert.equal(missing.exitCode, 1);
    const first = await report(root, "budgets.json");
    assert.deepEqual(first.missing, ["preview resolve p95", "settings to style p95", "longest extension task", "idle CPU, 30 s"]);
    const byName = Object.fromEntries(first.measurements.map((m) => [m.name, m]));
    assert.equal(byName["dist/chrome unpacked"].actual, 140);
    assert.equal(byName["bundled fonts (WOFF2)"].actual, 40);
    assert.equal(byName["dist/userscript/github-reskin.user.js"].actual, 30);
    assert.equal(byName["github-reskin-9.9.9-firefox.zip"].budget, BUDGETS.runtimeZipBytes);
    assert.ok(first.measurements.every((m) => m.ok));
    assert.equal(first.machine.node, process.versions.node);

    await writeFile(join(root, "artifacts", "reports", "release-timings.json"), TIMINGS);
    assert.deepEqual(await quiet(() => checkBudgets({ root, site, engine })), { exitCode: 0, testCount: first.measurements.length + 4 + 4 });
    assert.equal((await report(root, "budgets.json")).timings.machine.cpu, "test");
    // The site's own route failing fails the whole check.
    assert.equal((await quiet(() => checkBudgets({ root, site: async () => ({ exitCode: 1, testCount: 4 }), engine }))).exitCode, 1);
    assert.equal((await quiet(() => checkBudgets({ root, args: ["--surface=site"], site, engine }))).exitCode, 1);
  });
});

test("check:budgets fails one byte over a budget, a task at the long-task limit, and a package it cannot find", async () => {
  await withRoot({ ...BUILT, "artifacts/reports/release-timings.json": TIMINGS, "artifacts/github-reskin-9.9.9-chrome.zip": Buffer.alloc(BUDGETS.runtimeZipBytes + 1) }, async (root) => {
    assert.equal((await quiet(() => checkBudgets({ root, site, engine }))).exitCode, 1);
    const over = (await report(root, "budgets.json")).measurements.filter((m) => !m.ok).map((m) => m.name);
    assert.deepEqual(over, ["github-reskin-9.9.9-chrome.zip"]);
  });
  await withRoot({ ...BUILT, "artifacts/reports/release-timings.json": JSON.stringify({ ...JSON.parse(TIMINGS), longestTaskMs: BUDGETS.longTaskMs }) }, async (root) => {
    assert.equal((await quiet(() => checkBudgets({ root, site, engine }))).exitCode, 1);
    assert.deepEqual((await report(root, "budgets.json")).measurements.filter((m) => !m.ok).map((m) => m.name), ["longest extension task"]);
  });
  const { "artifacts/github-reskin-9.9.9-firefox.zip": _, ...withoutFirefox } = BUILT;
  await withRoot({ ...withoutFirefox, "artifacts/reports/release-timings.json": TIMINGS }, async (root) => {
    assert.equal((await quiet(() => checkBudgets({ root, site, engine }))).exitCode, 1);
    assert.deepEqual((await report(root, "budgets.json")).missing, ["github-reskin-9.9.9-firefox.zip"]);
  });
});

const withStores = (stores, files = {}) => ({ "release.config.json": JSON.stringify({ ...CONFIG, stores }), "README.md": "# GitHub Reskin\n", ...files });
const page = (status, body) => async () => ({ status, text: async () => body });

test("check:store-links accepts null or real listings and finds a listing named anywhere else", async () => {
  await withRoot(withStores({ chrome: null, firefox: null }, { "site/src/pages/index.astro": "<a href={STORES.chrome}>Chrome</a>" }), async (root) => {
    assert.equal((await quiet(() => checkStoreLinks({ root }))).exitCode, 0);
  });
  await withRoot(withStores({ chrome: CHROME, firefox: FIREFOX }, { "README.md": `Install from [Chrome](${CHROME}) or [Firefox](${FIREFOX}).` }), async (root) => {
    assert.equal((await quiet(() => checkStoreLinks({ root }))).exitCode, 0);
  });
  for (const stores of [{ chrome: "https://example.com/reskin", firefox: null }, { chrome: null, firefox: "https://addons.mozilla.org/firefox/addon/github-reskin/?src=search" }, { chrome: null }, { chrome: null, firefox: null, safari: null }]) {
    await withRoot(withStores(stores), async (root) => assert.equal((await quiet(() => checkStoreLinks({ root }))).exitCode, 1, JSON.stringify(stores)));
  }
  await withRoot(withStores({ chrome: null, firefox: null }, { "README.md": `Get it at ${FIREFOX}.` }), async (root) => {
    assert.equal((await quiet(() => checkStoreLinks({ root }))).exitCode, 1);
  });
  await withRoot(withStores({ chrome: CHROME, firefox: null }, { "site/src/lib/links.mjs": `export const OLD = "https://chrome.google.com/webstore/detail/old";` }), async (root) => {
    assert.equal((await quiet(() => checkStoreLinks({ root }))).exitCode, 1);
  });
  await withRoot(withStores({ chrome: null, firefox: null }), async (root) => assert.equal((await quiet(() => checkStoreLinks({ root, args: ["--live"] }))).exitCode, 1));
});

test("check:store-links --require-live needs both listings, each answering with the product's name", async () => {
  await withRoot(withStores({ chrome: CHROME, firefox: null }), async (root) => {
    assert.equal((await quiet(() => checkStoreLinks({ root, args: ["--require-live"], fetchPage: page(200, "GitHub Reskin") }))).exitCode, 1);
  });
  await withRoot(withStores({ chrome: CHROME, firefox: FIREFOX }), async (root) => {
    const fetched = [];
    const fetchPage = async (url) => (fetched.push(url), { status: 200, text: async () => "<title>GitHub Reskin</title>" });
    assert.equal((await quiet(() => checkStoreLinks({ root, args: ["--require-live"], fetchPage }))).exitCode, 0);
    assert.deepEqual(fetched, [CHROME, FIREFOX]);
    assert.equal((await quiet(() => checkStoreLinks({ root, args: ["--require-live"], fetchPage: page(404, "") }))).exitCode, 1);
    assert.equal((await quiet(() => checkStoreLinks({ root, args: ["--require-live"], fetchPage: page(200, "Some other add-on") }))).exitCode, 1);
    const offline = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    assert.equal((await quiet(() => checkStoreLinks({ root, args: ["--require-live"], fetchPage: offline }))).exitCode, 1);
  });
  // Without the flag nothing is fetched.
  await withRoot(withStores({ chrome: CHROME, firefox: FIREFOX }), async (root) => {
    const fetchPage = async () => assert.fail("fetched without --require-live");
    assert.equal((await quiet(() => checkStoreLinks({ root, fetchPage }))).exitCode, 0);
  });
});
