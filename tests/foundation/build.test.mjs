import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { SHARED_BUILD_SCOPES } from "../../packages/contracts/index.js";
import { NotImplementedError, ROOT, SHARED_SCOPES, build, bundlePackages, treeHash } from "../../scripts/build.mjs";
import { withTempDir } from "../helpers/tmp.mjs";

const node = (args, options = {}) => promisify(execFile)(process.execPath, args, { cwd: ROOT, ...options });
const OFFLINE = ["--import", "./tests/helpers/no-network.mjs"];

test("two builds of each target write the same files", async () => {
  await withTempDir(async (tmp) => {
    for (const target of ["chrome", "firefox", "userscript"]) {
      const first = await build({ target, outDir: join(tmp, "a") });
      const second = await build({ target, outDir: join(tmp, "b") });
      assert.ok(Object.keys(first.files).length > 0, target);
      assert.equal(treeHash(first.files), treeHash(second.files), target);
    }
    const [a, b] = [await bundlePackages(["contracts"]), await bundlePackages(["contracts"])];
    assert.deepEqual(a, b);
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
  const { "contracts.js": bundle } = await bundlePackages(["contracts"]);
  const text = bundle.toString("utf8");
  assert.match(text, /DEFAULT_THEME_ID = "anime\.cyberpunk-edgerunners"/);
  assert.doesNotMatch(text, /from "node:|require\(/);
  assert.doesNotMatch(text, /\/Users\/|[A-Z]:\\/, "no absolute paths");
  await withTempDir(async (tmp) => {
    await mkdir(join(tmp, "packages", "bad"), { recursive: true });
    await writeFile(join(tmp, "packages", "bad", "package.json"), JSON.stringify({ type: "module", exports: { ".": "./index.js" } }));
    await writeFile(join(tmp, "packages", "bad", "index.js"), `import { readFileSync } from "node:fs";\nexport const read = readFileSync;\n`);
    await assert.rejects(bundlePackages(["bad"], { root: tmp }), /node:fs/);
  });
});

test("each shared scope builds all of its prerequisites, and fails while one is missing", async () => {
  assert.deepEqual(Object.keys(SHARED_SCOPES), [...SHARED_BUILD_SCOPES]);
  const names = (scope) => SHARED_SCOPES[scope].packages.map(([name]) => name);
  assert.deepEqual(names("engine"), ["contracts", "format", "engine"]);
  assert.deepEqual(names("primer"), [...names("engine"), "primer"]);
  assert.deepEqual(names("preview"), [...names("primer"), "appearance", "preview"]);
  assert.deepEqual(SHARED_SCOPES.primer.inputs, [["vendor/primer/modes.json", "C3"]]);

  await withTempDir(async (tmp) => {
    for (const scope of SHARED_BUILD_SCOPES) {
      const { packages, inputs } = SHARED_SCOPES[scope];
      const missing = [
        ...packages.filter(([name]) => !existsSync(join(ROOT, "packages", name, "package.json"))).map(([name]) => `packages/${name}`),
        ...inputs.filter(([path]) => !existsSync(join(ROOT, path))).map(([path]) => path),
      ];
      const run = build({ target: "shared", scope, outDir: tmp });
      if (!missing.length) {
        const { files } = await run;
        assert.deepEqual(Object.keys(files).sort(), packages.map(([name]) => `${name}.js`).sort(), scope);
        continue;
      }
      await assert.rejects(run, (error) => error instanceof NotImplementedError && missing.every((path) => error.message.includes(path)), scope);
    }
    await assert.rejects(build({ target: "shared", scope: "everything", outDir: tmp }), /Unknown shared scope/);
    await assert.rejects(build({ target: "chrome", scope: "engine", outDir: tmp }), /applies to the shared target/);
    if (!existsSync(join(ROOT, "packages/format/package.json"))) {
      const cli = node(["scripts/build.mjs", "--target", "shared", "--scope", "engine", "--out", tmp]);
      await assert.rejects(cli, (error) => error.code === 2 && /NOT IMPLEMENTED: shared --scope=engine \(owner C2\)/.test(error.stderr));
    }
  });
});

test("the site target delegates to site/build.mjs, and a full build fails instead of succeeding empty", async () => {
  if (existsSync(join(ROOT, "site/build.mjs"))) {
    await withTempDir(async (tmp) => assert.ok(Object.keys((await build({ target: "site", outDir: tmp })).files).length > 0));
    return;
  }
  await assert.rejects(build({ target: "site", outDir: "dist" }), (error) => error instanceof NotImplementedError && /^site \(owner C7\): site\/build\.mjs does not exist/.test(error.message));
  await withTempDir(async (tmp) => {
    const run = node(["scripts/build.mjs", "--target", "all", "--out", tmp]);
    await assert.rejects(run, (error) => error.code === 2 && /NOT IMPLEMENTED: site \(owner C7\)/.test(error.stderr) && /NOT IMPLEMENTED: shared \(owner/.test(error.stderr));
  });
});

test("builds refuse an output directory that contains the source", async () => {
  await assert.rejects(build({ target: "chrome", outDir: "." }), /contains the source/);
  await assert.rejects(build({ target: "chrome", outDir: ".." }), /contains the source/);
  await assert.rejects(build({ target: "nope", outDir: "dist" }), /Unknown target/);
});

test("builds work with the network disabled, and never run the network mode generator", async () => {
  await withTempDir(async (tmp) => {
    const { stdout } = await node([...OFFLINE, "scripts/build.mjs", "--target", "chrome,firefox,userscript", "--out", tmp]);
    assert.match(stdout, /built .*firefox/);
  });
  // The guard is real: the old generator fails under it.
  await assert.rejects(node([...OFFLINE, "scripts/github-modes.mjs"]), /Network access/);
  for (const script of ["build", "package", "check", "check-routes", "check-a11y", "serve", "verify-artifacts", "verify-repro"]) {
    const source = await readFile(join(ROOT, `scripts/${script}.mjs`), "utf8");
    assert.doesNotMatch(source, /(import|spawn|exec|fork)\w*\([^)]*github-modes/, script);
    assert.doesNotMatch(source, /\bfetch\(|https?\.request|new Date\(\)|Date\.now\(\)|Math\.random\(/, script);
  }
});
