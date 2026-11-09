import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { SHARED_BUILD_SCOPES } from "../../packages/contracts/index.js";
import { FONT_INPUTS, NotImplementedError, ROOT, SHARED_SCOPES, build, buildSharedFrom, buildSiteFrom, buildUserscriptFrom, bundlePackages, sharedPrerequisites, treeHash } from "../../scripts/build.mjs";
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
  const inputs = (scope) => SHARED_SCOPES[scope].inputs.map(([path]) => path);
  assert.deepEqual(names("engine"), ["contracts", "format", "engine"]);
  assert.deepEqual(names("primer"), [...names("engine"), "primer"]);
  assert.deepEqual(names("preview"), [...names("primer"), "appearance", "preview"]);
  assert.deepEqual(inputs("engine"), []);
  assert.deepEqual(inputs("primer"), ["vendor/primer/modes.json", "licenses/primer-primitives.txt"]);
  assert.deepEqual(inputs("preview"), [...inputs("primer"), ...FONT_INPUTS.map(([path]) => path)]);
  // Eight bundled families, one WOFF2 and one OFL notice each, all C5's.
  assert.equal(FONT_INPUTS.length, 16);
  assert.ok(FONT_INPUTS.every(([path, owner]) => owner === "C5" && /^assets\/fonts\/([a-z-]+)\/(\1\.woff2|OFL\.txt)$/.test(path)));

  await withTempDir(async (tmp) => {
    for (const scope of SHARED_BUILD_SCOPES) {
      const { missing, broken } = await sharedPrerequisites(scope);
      const run = build({ target: "shared", scope, outDir: tmp });
      if (!missing.length && !broken.length) {
        const { files } = await run;
        assert.deepEqual(Object.keys(files).sort(), [...names(scope).map((name) => `${name}.js`), ...inputs(scope)].sort(), scope);
        continue;
      }
      if (missing.length) await assert.rejects(run, (error) => error instanceof NotImplementedError && missing.every(([path, owner]) => error.message.includes(`${path} (${owner})`)), scope);
      else await assert.rejects(run, scope);
    }
    await assert.rejects(build({ target: "shared", scope: "everything", outDir: tmp }), /Unknown shared scope/);
    await assert.rejects(build({ target: "chrome", scope: "engine", outDir: tmp }), /applies to the shared target/);
    if (!existsSync(join(ROOT, "packages/format/package.json"))) {
      const cli = node(["scripts/build.mjs", "--target", "shared", "--scope", "engine", "--out", tmp]);
      await assert.rejects(cli, (error) => error.code === 2 && /NOT IMPLEMENTED: shared --scope=engine \(owner C2\)/.test(error.stderr));
    }
  });
});

// A root holding every shared package as a small real module, the Primer notice, and the given files.
async function withSharedRoot(files, fn) {
  return withTempDir(async (root) => {
    const write = async (path, content) => {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content);
    };
    for (const [name] of SHARED_SCOPES.preview.packages) {
      await write(`packages/${name}/package.json`, JSON.stringify({ type: "module", exports: { ".": "./index.js" } }));
      await write(`packages/${name}/index.js`, `export const name = ${JSON.stringify(name)};\n`);
    }
    await write("licenses/primer-primitives.txt", "MIT\n");
    // null removes a file.
    for (const [path, content] of Object.entries(files)) await (content === null ? rm(join(root, path), { force: true }) : write(path, content));
    return fn(root, join(root, "out"));
  });
}

const fonts = Object.fromEntries(FONT_INPUTS.map(([path]) => [path, path.endsWith(".woff2") ? Buffer.from("wOF2font") : "OFL\n"]));
const modes = JSON.stringify({ contractVersion: 1, modes: {} });

test("a shared scope with every prerequisite builds them all into nonempty output", async () => {
  await withSharedRoot({ "vendor/primer/modes.json": modes, ...fonts }, async (root, out) => {
    for (const scope of SHARED_BUILD_SCOPES) {
      assert.deepEqual(await sharedPrerequisites(scope, { root }), { missing: [], broken: [] }, scope);
      const { files } = await buildSharedFrom(root, { outDir: out, scope });
      const { packages, inputs } = SHARED_SCOPES[scope];
      assert.deepEqual(Object.keys(files).sort(), [...packages.map(([name]) => `${name}.js`), ...inputs.map(([path]) => path)].sort(), scope);
      if (inputs.length) assert.equal(await readFile(join(out, "shared", "vendor/primer/modes.json"), "utf8"), modes, scope);
    }
  });
});

test("shared scopes reject missing fonts, empty or dataless modes, empty fonts and empty bundles, naming the owner", async () => {
  // The review's case: real package entries, an empty modes.json and no fonts.
  await withSharedRoot({ "vendor/primer/modes.json": "" }, async (root, out) => {
    const { missing, broken } = await sharedPrerequisites("preview", { root });
    assert.deepEqual(missing, FONT_INPUTS);
    assert.deepEqual(broken, ["vendor/primer/modes.json (C3) is empty"]);
    await assert.rejects(buildSharedFrom(root, { outDir: out, scope: "preview" }), (error) => error instanceof NotImplementedError && /^shared --scope=preview \(owner C5\): needs assets\/fonts\/rajdhani\/rajdhani\.woff2 \(C5\)/.test(error.message));
    await assert.rejects(buildSharedFrom(root, { outDir: out, scope: "primer" }), /shared --scope=primer:\n {2}vendor\/primer\/modes\.json \(C3\) is empty/);
    assert.deepEqual(await sharedPrerequisites("engine", { root }), { missing: [], broken: [] });
  });
  for (const [content, why] of [["{}", "holds no data"], ["[]", "holds no data"], ["{", "is not valid JSON"]]) {
    await withSharedRoot({ "vendor/primer/modes.json": content }, async (root) => {
      assert.deepEqual((await sharedPrerequisites("primer", { root })).broken, [`vendor/primer/modes.json (C3) ${why}`], content);
    });
  }
  await withSharedRoot({ "vendor/primer/modes.json": modes, ...fonts, "assets/fonts/bungee/bungee.woff2": "" }, async (root, out) => {
    await assert.rejects(buildSharedFrom(root, { outDir: out, scope: "preview" }), /assets\/fonts\/bungee\/bungee\.woff2 \(C5\) is empty/);
  });
  await withSharedRoot({ "vendor/primer/modes.json": null }, async (root) => {
    assert.deepEqual((await sharedPrerequisites("primer", { root })).missing, [["vendor/primer/modes.json", "C3"]]);
  });
  // A package whose entry is missing, empty, or bundles to nothing.
  await withSharedRoot({ "packages/engine/index.js": null }, async (root) => {
    assert.deepEqual((await sharedPrerequisites("engine", { root })).missing, [["packages/engine/index.js", "C2"]]);
  });
  await withSharedRoot({ "packages/format/index.js": "" }, async (root) => {
    assert.deepEqual((await sharedPrerequisites("engine", { root })).broken, ["packages/format/index.js (C2) is empty"]);
  });
  await withSharedRoot({ "packages/format/index.js": "// nothing yet\n" }, async (root, out) => {
    await assert.rejects(buildSharedFrom(root, { outDir: out, scope: "engine" }), /shared --scope=engine wrote empty output: format\.js \(C2\)/);
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

test("the site hook gets the site directory and release config, and must write a nonempty index.html", async () => {
  const site = (body) => `import { mkdir, writeFile } from "node:fs/promises";\nimport { join } from "node:path";\nexport async function build({ outDir, config }) {\n${body}\n}\n`;
  const cases = [
    [site(`await writeFile(join(outDir, "index.html"), "<!doctype html><title>" + config.site.base + "</title>"); await writeFile(join(outDir, ".nojekyll"), "");`), null],
    [site(`await writeFile(join(outDir, "index.html"), "");`), /site\/build\.mjs \(C7\) wrote no nonempty index\.html/],
    [site(`await mkdir(join(outDir, "about"), { recursive: true }); await writeFile(join(outDir, "about/index.html"), "<p>");`), /site\/build\.mjs \(C7\) wrote no nonempty index\.html/],
    [site(""), /site\/build\.mjs \(C7\) wrote nothing/],
    ["export const build = 1;\n", /site \(owner C7\): site\/build\.mjs has no build export/],
  ];
  for (const [i, [source, failure]] of cases.entries()) {
    await withTempDir(async (root) => {
      await mkdir(join(root, "site"));
      await writeFile(join(root, "site", `build.mjs`), source);
      const run = buildSiteFrom(root, { outDir: join(root, `out${i}`), releaseConfig: { site: { base: "/GitHub-Reskin" } } });
      if (!failure) {
        const { dir, files } = await run;
        assert.deepEqual(Object.keys(files).sort(), [".nojekyll", "index.html"]);
        assert.equal(await readFile(join(dir, "index.html"), "utf8"), "<!doctype html><title>/GitHub-Reskin</title>");
      } else await assert.rejects(run, failure, String(i));
    });
  }
});

test("the userscript hook must return a nonempty script", async () => {
  const cases = [
    ['export async function build() { return "// ==UserScript==\\n// ==/UserScript==\\n"; }\n', null],
    ['export async function build() { return ""; }\n', /stub\.mjs \(C8\) returned an empty userscript/],
  ];
  for (const [i, [source, failure]] of cases.entries()) {
    await withTempDir(async (root) => {
      await writeFile(join(root, "stub.mjs"), source);
      const run = buildUserscriptFrom(root, { outDir: join(root, `out${i}`), releaseConfig: { userscript: { builder: "stub.mjs", output: "x.user.js" } } });
      if (!failure) assert.deepEqual(Object.keys((await run).files), ["x.user.js"]);
      else await assert.rejects(run, failure);
    });
  }
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
