import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ROOT } from "../../scripts/build.mjs";
import { discoverTests } from "../../scripts/check.mjs";
import { ROUTES, SURFACE_COMMANDS } from "../../scripts/check-routes.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

// Without node:test's own context variable, so the child runs as a top-level test runner.
const { NODE_TEST_CONTEXT, ...env } = process.env;
const check = (args) => promisify(execFile)(process.execPath, ["scripts/check.mjs", ...args], { cwd: ROOT, env });
const fails = (args, code, pattern) => assert.rejects(check(args), (error) => error.code === code && pattern.test(error.stdout + error.stderr));

test("the test runner fails when it discovers no tests", async () => {
  await withTempDir(async (tmp) => {
    await fails(["test", tmp], 1, /No test files found/);
    await fails(["test", join(tmp, "missing")], 1, /No test files found/);
    // node --test counts a file without tests as one passing test. This runner does not.
    await writeFile(join(tmp, "empty.test.mjs"), "// nothing here\n");
    await fails(["test", tmp], 1, /empty\.test\.mjs ran no tests/);
  });
});

test("by default the runner finds the Action, extension, userscript and unit tests, and no e2e specs", async () => {
  const { files, empty } = await discoverTests();
  assert.equal(empty, undefined);
  const found = files.map((file) => relative(realpathSync(ROOT), file).split("\\").join("/"));
  for (const path of ["test.mjs", "extension.test.mjs", "userscript.test.mjs", "tests/foundation/check.test.mjs"]) assert.ok(found.includes(path), path);
  assert.ok(!found.some((path) => path.startsWith("tests/e2e/") || path.startsWith("node_modules/") || path.startsWith("tests/helpers/")));
});

test("the test runner counts tests per file and fails on failures and skips", async () => {
  await withTempDir(async (tmp) => {
    await writeFile(join(tmp, "a.test.mjs"), `import test from "node:test";\ntest("one", () => {});\ntest("two", () => {});\n`);
    const { stdout } = await check(["test", tmp]);
    assert.match(stdout, /1 files, 2 tests: 2 passed, 0 failed, 0 skipped/);
    await writeFile(join(tmp, "b.test.mjs"), `import test from "node:test";\ntest("skipped", { skip: true }, () => {});\n`);
    await fails(["test", tmp], 1, /0 failed, 1 skipped/);
    await writeFile(join(tmp, "b.test.mjs"), `import test from "node:test";\ntest("fails", () => { throw new Error("no"); });\n`);
    await fails(["test", tmp], 1, /1 failed/);
    await writeFile(join(tmp, "b.test.mjs"), `throw new Error("cannot load");\n`);
    await fails(["test", tmp], 1, /b\.test\.mjs ran no tests/);
  });
});

// Each file has a passing test beside the problem, so only the problem can fail the run.
const SUITE_PROBLEMS = {
  "a suite's after hook throws": [`describe("suite", () => { it("passes", () => {}); after(() => { throw new Error("cleanup failed"); }); });`, /suite "suite" .* failed \(hookFailed\)/],
  "a suite's before hook throws": [`describe("suite", () => { before(() => { throw new Error("setup failed"); }); it("never runs", () => {}); });`, /1 failed|suite "suite" .* failed/],
  "a test's beforeEach hook throws": [`describe("suite", () => { beforeEach(() => { throw new Error("setup failed"); }); it("never runs", () => {}); });`, /1 failed/],
  "a suite callback throws while registering tests": [`describe("suite", () => { throw new Error("registration failed"); });`, /suite "suite" .* failed \(testCodeFailure\)/],
  "a file's top-level after hook throws": [`after(() => { throw new Error("cleanup failed"); });`, /failed outside any test \(hookFailed\)/],
  "a required suite is skipped": [`describe.skip("required", () => { it("would run", () => {}); });`, /1 skipped/],
  "a required suite is todo": [`describe.todo("required", () => { it("would run", () => {}); });`, /skipped/],
  "a required test is skipped": [`it.skip("required", () => {});`, /1 skipped/],
  "a required test is todo": [`it.todo("required");`, /1 skipped/],
};

for (const [problem, [source, output]] of Object.entries(SUITE_PROBLEMS)) {
  test(`the test runner exits nonzero when ${problem}`, async () => {
    await withTempDir(async (tmp) => {
      const header = `import { after, before, beforeEach, describe, it, test } from "node:test";\ntest("passes", () => {});\n`;
      await writeFile(join(tmp, "probe.test.mjs"), `${header}${source}\n`);
      await fails(["test", tmp], 1, output);
    });
  });
}

test("a suite that fails because a test in it failed counts that test once", async () => {
  await withTempDir(async (tmp) => {
    await writeFile(join(tmp, "probe.test.mjs"), `import { describe, it } from "node:test";\ndescribe("suite", () => { it("passes", () => {}); it("fails", () => { throw new Error("no"); }); });\n`);
    await fails(["test", tmp], 1, /2 tests: 1 passed, 1 failed, 0 skipped/);
  });
});

test("every acceptance script exists and runs through the check router", async () => {
  const { scripts } = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const named = [
    "test", "test:e2e", "check:harness", "check:toolchain", "check:release", "check:schema", "check:themes", "check:classic-themes", "check:prompt",
    "check:primer", "check:contrast", "check:slot-contracts", "check:migrations", "check:boot", "check:fonts", "check:effects",
    "build", "build:stores", "build:shared", "build:site", "build:userscript", "check:userscript", "check:site", "check:a11y",
    "lint:chrome", "lint:firefox", "check:budgets", "package", "check:artifacts", "check:repro", "check:store-links",
    "check:video", "render:video", "verify:video", "capture:release", "qa:live", "qa:firefox", "qa:userscript", "qa:published-install",
  ];
  for (const name of named) assert.ok(scripts[name], name);
  const commands = new Set([...SURFACE_COMMANDS, ...Object.keys(ROUTES)]);
  for (const [name, command] of Object.entries(scripts)) {
    const routed = /^node scripts\/check\.mjs (\S+)/.exec(command)?.[1];
    if (routed) assert.ok(commands.has(routed), `${name} runs ${routed}, which has no route`);
  }
  // Every check script, artifacts and repro included, goes through the router with its dispatcher key.
  for (const [name, key] of [["check:artifacts", "artifacts"], ["check:repro", "repro"], ["test:e2e", "test:e2e"], ["check:a11y", "a11y"], ["check:contrast", "contrast"]]) {
    assert.equal(scripts[name], `node scripts/check.mjs ${key}`, name);
  }
  await fails(["no-such-check"], 1, /Unknown check/);
});

test("the CLI drops a typed -- separator and forwards the rest, and local checks reject arguments they do not take", async () => {
  if (!existsSync(join(ROOT, "packages/engine/checks.mjs"))) {
    await fails(["contrast", "--", "--scope=primer"], 2, /NOT IMPLEMENTED: contrast \(owner C2\): packages\/engine\/checks\.mjs does not exist/);
  }
  await fails(["toolchain", "--verbose"], 1, /toolchain takes no arguments, got --verbose/);
  await fails(["repro", "--fast"], 1, /repro \(owner C1\) threw: TypeError .*--fast/);
  await withTempDir(async (tmp) => {
    // check:artifacts through its run adapter: real assertions, failing on an empty directory.
    await fails(["artifacts", "--dir", tmp], 1, /check:artifacts found \d+ problem\(s\) in \d+ checks/);
  });
});
