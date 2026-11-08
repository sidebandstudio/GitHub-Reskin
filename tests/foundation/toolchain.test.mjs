import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const json = async (path) => JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), "utf8"));
const text = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the toolchain is pinned to exact Node, npm and dependency versions in one place", async () => {
  const [pkg, lock, config] = await Promise.all([json("package.json"), json("package-lock.json"), json("release.config.json")]);
  assert.deepEqual(config.toolchain, { node: "24.22.2", npm: "11.12.1" });
  assert.deepEqual(pkg.engines, config.toolchain);
  assert.equal(pkg.version, config.version);
  assert.equal(pkg.packageManager, `npm@${config.toolchain.npm}`);
  assert.equal((await text(".node-version")).trim(), config.toolchain.node);
  assert.match(await text(".npmrc"), /^engine-strict=true$/m);
  assert.match(await text(".npmrc"), /^save-exact=true$/m);

  assert.equal(pkg.dependencies, undefined, "nothing is a runtime dependency");
  const required = ["esbuild", "astro", "ajv", "jsonc-parser", "fflate", "@playwright/test", "axe-core", "web-ext"];
  for (const name of required) assert.ok(pkg.devDependencies[name], name);
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is an exact version`);
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} is locked at ${version}`);
  }
});

test("every locked package comes from the npm registry with an integrity hash", async () => {
  const lock = await json("package-lock.json");
  assert.equal(lock.lockfileVersion, 3);
  const packages = Object.entries(lock.packages).filter(([path]) => path);
  assert.ok(packages.length > 100);
  for (const [path, entry] of packages) {
    if (entry.link) continue;
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, path);
    assert.match(entry.integrity, /^sha512-/, path);
  }
});

test("the GitHub Action still runs with Node's built-ins only", async () => {
  const action = await text("action.yml");
  assert.match(action, /^ {2}using: node24$/m);
  assert.match(action, /^ {2}main: index\.mjs$/m);
  const imports = [...(await text("index.mjs")).matchAll(/^import [^"]*"([^"]+)"/gm)].map(([, from]) => from);
  assert.ok(imports.length > 0);
  for (const from of imports) assert.match(from, /^node:/, from);
  assert.doesNotMatch(await text("index.mjs"), /\bimport\(|require\(/);
});

// The historical flat graphs must stay byte-identical. test.mjs compares output to them.
test("the Action's flat fixtures are unchanged", async () => {
  const hash = async (path) => createHash("sha256").update(await readFile(new URL(`../../${path}`, import.meta.url))).digest("hex");
  assert.equal(await hash("fixtures/flat.svg"), "6c24607e34e6d50d6a3958cd8571b628f2efb7d12e75ace603817465b35696bf");
  assert.equal(await hash("fixtures/flat-colors.svg"), "2c56952902cf976550af382ed81a9431d12e333c65220e86d616caa8be7fa00c");
});
