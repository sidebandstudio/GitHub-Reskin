import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ROOT } from "../../scripts/build.mjs";
import { discoverTests } from "../../scripts/check.mjs";
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

test("every acceptance script exists, and unbuilt gates fail as not implemented", async () => {
  const { scripts } = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const named = [
    "test", "test:e2e", "check:toolchain", "check:release", "check:schema", "check:themes", "check:classic-themes", "check:prompt",
    "check:primer", "check:contrast", "check:slot-contracts", "check:migrations", "check:boot", "check:fonts", "check:effects",
    "build", "build:stores", "build:shared", "build:site", "build:userscript", "check:userscript", "check:site", "check:a11y",
    "lint:chrome", "lint:firefox", "check:budgets", "package", "check:artifacts", "check:repro", "check:store-links",
    "check:video", "render:video", "verify:video", "capture:release", "qa:live", "qa:firefox", "qa:userscript", "qa:published-install",
  ];
  for (const name of named) assert.ok(scripts[name], name);
  for (const [name, command] of Object.entries(scripts)) {
    const pending = /^node scripts\/check\.mjs (\S+)$/.exec(command)?.[1];
    if (!pending || ["test", "toolchain", "lint-firefox", "lint-chrome"].includes(pending)) continue;
    await fails([pending], 2, /NOT IMPLEMENTED: .* belongs to C\d+/);
  }
  await fails(["no-such-check"], 1, /Unknown check/);
});
