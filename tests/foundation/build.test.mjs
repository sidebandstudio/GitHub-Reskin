import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { NotImplementedError, ROOT, build, treeHash } from "../../scripts/build.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const node = (args, options = {}) => promisify(execFile)(process.execPath, args, { cwd: ROOT, ...options });
const OFFLINE = ["--import", "./tests/helpers/no-network.mjs"];

test("two builds of each target write the same files", async () => {
  await withTempDir(async (tmp) => {
    for (const target of ["chrome", "firefox", "userscript", "shared"]) {
      const first = await build({ target, outDir: join(tmp, "a") });
      const second = await build({ target, outDir: join(tmp, "b") });
      assert.ok(Object.keys(first.files).length > 0, target);
      assert.equal(treeHash(first.files), treeHash(second.files), target);
    }
  });
});

test("the browser packages carry the 1.1.0 files unchanged", async () => {
  await withTempDir(async (tmp) => {
    const { dir, files } = await build({ target: "firefox", outDir: tmp });
    const licenses = ["LICENSE", "licenses/primer-primitives.txt"];
    for (const path of Object.keys(files).filter((p) => p !== "manifest.json" && !licenses.includes(p))) {
      assert.deepEqual(await readFile(join(dir, path)), await readFile(join(ROOT, "extension", path)), path);
    }
    for (const path of licenses) assert.deepEqual(await readFile(join(dir, path)), await readFile(join(ROOT, path)), path);
  });
});

test("the built userscript is the committed one", async () => {
  await withTempDir(async (tmp) => {
    const { dir } = await build({ target: "userscript", outDir: tmp });
    const committed = (await readFile(join(ROOT, "userscript/github-reskin.user.js"), "utf8")).replace(/\r\n/g, "\n");
    assert.equal(await readFile(join(dir, "github-reskin.user.js"), "utf8"), committed);
  });
});

test("shared packages bundle for browsers without Node built-ins", async () => {
  await withTempDir(async (tmp) => {
    const { dir, files } = await build({ target: "shared", outDir: tmp });
    assert.ok(files["contracts.js"]);
    const bundle = await readFile(join(dir, "contracts.js"), "utf8");
    assert.match(bundle, /DEFAULT_THEME_ID = "anime\.cyberpunk-edgerunners"/);
    assert.doesNotMatch(bundle, /from "node:|require\(/);
    assert.doesNotMatch(bundle, /\/Users\/|[A-Z]:\\/, "no absolute paths");
  });
});

test("the site is reported as not implemented, and a full build fails instead of succeeding empty", async () => {
  await assert.rejects(build({ target: "site", outDir: "dist" }), (error) => error instanceof NotImplementedError && /C7/.test(error.message));
  await withTempDir(async (tmp) => {
    const run = node(["scripts/build.mjs", "--target", "all", "--out", tmp]);
    await assert.rejects(run, (error) => error.code === 2 && /NOT IMPLEMENTED: site/.test(error.stderr));
  });
});

test("builds refuse an output directory that contains the source", async () => {
  await assert.rejects(build({ target: "chrome", outDir: "." }), /contains the source/);
  await assert.rejects(build({ target: "chrome", outDir: ".." }), /contains the source/);
  await assert.rejects(build({ target: "nope", outDir: "dist" }), /Unknown target/);
});

test("builds work with the network disabled, and never run the network mode generator", async () => {
  await withTempDir(async (tmp) => {
    const { stdout } = await node([...OFFLINE, "scripts/build.mjs", "--target", "chrome,firefox,userscript,shared", "--out", tmp]);
    assert.match(stdout, /built .*firefox/);
  });
  // The guard is real: the old generator fails under it.
  await assert.rejects(node([...OFFLINE, "scripts/github-modes.mjs"]), /Network access/);
  for (const script of ["build", "package", "check", "serve", "verify-artifacts", "verify-repro"]) {
    const source = await readFile(join(ROOT, `scripts/${script}.mjs`), "utf8");
    assert.doesNotMatch(source, /(import|spawn|exec|fork)\w*\([^)]*github-modes/, script);
    assert.doesNotMatch(source, /\bfetch\(|https?\.request|new Date\(\)|Date\.now\(\)|Math\.random\(/, script);
  }
});
