// Builds the runtime targets from checked-in sources and lockfile-installed packages only:
// no network, no clock and no file discovery. release.config.json picks an entry in
// extension/manifests/entries.json, and that entry lists every file a browser package gets.
// Run: node scripts/build.mjs --target chrome,firefox,userscript [--out dist]
//      node scripts/build.mjs --target shared [--scope engine|primer|preview]
// --target all builds every target and fails with exit 2 while any of them is not implemented yet.
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { BUILD_TARGETS, FONT_IDS, GECKO_ID, SHARED_BUILD_SCOPES as BUILD_SCOPES } from "../packages/contracts/index.js";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Files every browser package carries besides its entry and the entry's upstream notices.
export const LICENSE_FILES = ["LICENSE"];
const TEXT = /\.(js|mjs|css|html|json|txt|md|svg)$/;
// Test-only content-script matches. Production manifests never contain them.
const LOCAL_MATCH = /^http:\/\/(127\.0\.0\.1|localhost)\/\*$/;

export class NotImplementedError extends Error {
  constructor(target, owner, why) {
    super(`${target} (owner ${owner})${why ? `: ${why}` : ""}`);
    this.target = target;
    this.owner = owner;
  }
}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// One hash for a file tree, from its sorted paths and their hashes.
export const treeHash = (files) =>
  sha256(
    Object.keys(files)
      .sort()
      .map((path) => `${path}\0${files[path]}\n`)
      .join(""),
  );

// Text is built with LF line endings whatever the checkout uses, so builds agree across systems.
export async function readSource(path, root = ROOT) {
  const bytes = await readFile(join(root, path));
  return TEXT.test(path) ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n")) : bytes;
}

export const readJson = async (path) => JSON.parse((await readSource(path)).toString("utf8"));
export const loadReleaseConfig = () => readJson("release.config.json");

export async function loadEntry(config) {
  const entries = await readJson("extension/manifests/entries.json");
  const entry = Object.hasOwn(entries, config.extension.entry) && entries[config.extension.entry];
  if (!entry) throw new Error(`release.config.json names extension entry "${config.extension.entry}", which entries.json lacks`);
  return entry;
}

// The license files a package of this entry carries: the project's own, then each upstream notice.
export const licenseFiles = (entry) => [...LICENSE_FILES, ...entry.notices.map((notice) => notice.file)];

// The artifacts a license file ships in. The single-file userscript carries the extension's
// upstream material, so it embeds each upstream notice; the project's own LICENSE is in the archives.
export const licenseTargets = (entry, file) =>
  entry.notices.some((notice) => notice.file === file) ? ["chrome", "firefox", "userscript", "amo-source"] : ["chrome", "firefox", "amo-source"];

// Problems with an entry's notices, as messages. Every frozen input is upstream material, so each
// needs a notice that covers it, and each notice must cover files the entry really has.
export function noticeProblems(entry) {
  const problems = [];
  const covered = new Set();
  for (const notice of entry.notices || []) {
    if (!notice.file || !notice.license || !notice.upstream || !notice.covers?.length) problems.push(`notice ${JSON.stringify(notice)} needs file, license, upstream and covers`);
    for (const path of notice.covers || []) {
      if (!entry.files.includes(path)) problems.push(`notice ${notice.file} covers ${path}, which the entry lacks`);
      covered.add(path);
    }
  }
  for (const path of Object.keys(entry.frozen)) if (!covered.has(path)) problems.push(`frozen ${entry.root}/${path} has no upstream license notice`);
  return problems;
}

// Objects merge key by key; anything else in the overlay replaces the base value.
function merge(base, overlay) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const both = [out[key], value].every((v) => v && typeof v === "object" && !Array.isArray(v));
    out[key] = both ? merge(out[key], value) : value;
  }
  return out;
}

// The common manifest, the browser's overlay and the release version. Chrome never gets Gecko keys.
export async function extensionManifest(browser, config) {
  const { manifest_version, name, ...rest } = merge(
    await readJson("extension/manifests/base.json"),
    await readJson(`extension/manifests/${browser}.json`),
  );
  const manifest = { manifest_version, name, version: config.version, ...rest };
  if (browser === "chrome") delete manifest.browser_specific_settings;
  return manifest;
}

// Every package path a manifest refers to.
export function manifestPaths(manifest) {
  const paths = [
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    manifest.background?.service_worker,
    ...(manifest.background?.scripts || []),
    ...(manifest.content_scripts || []).flatMap((script) => [...(script.js || []), ...(script.css || [])]),
    ...(manifest.web_accessible_resources || []).flatMap((resource) => resource.resources || []),
  ];
  return [...new Set(paths.filter(Boolean))].sort();
}

// Problems with a manifest for this release, as messages. An empty list means it passes.
export function manifestProblems(manifest, browser, config, { testMatches = [] } = {}) {
  const problems = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
  if (manifest.version !== config.version) problems.push(`version ${manifest.version} is not the release version ${config.version}`);
  if (!same(manifest.permissions, config.extension.permissions)) {
    problems.push(`permissions ${JSON.stringify(manifest.permissions)} differ from ${JSON.stringify(config.extension.permissions)}`);
  }
  for (const key of ["host_permissions", "optional_permissions", "optional_host_permissions", "externally_connectable", "key", "update_url"]) {
    if (key in manifest) problems.push(`${key} is not allowed`);
  }
  const matches = [...config.extension.hostMatches, ...testMatches];
  for (const script of manifest.content_scripts || []) {
    if (!same(script.matches, matches)) problems.push(`content script matches ${JSON.stringify(script.matches)} differ from ${JSON.stringify(matches)}`);
    if (script.all_frames) problems.push("content scripts run in the top frame only");
  }
  const gecko = manifest.browser_specific_settings;
  if (browser === "chrome" && gecko) problems.push("the Chrome manifest must not contain browser_specific_settings");
  if (browser === "firefox") {
    if (gecko?.gecko?.id !== GECKO_ID || config.extension.geckoId !== GECKO_ID) problems.push(`the Gecko ID must be ${GECKO_ID}`);
    if (gecko?.gecko?.strict_min_version !== "140.0") problems.push("the Gecko minimum must be 140.0");
    if (!same(gecko?.gecko?.data_collection_permissions, { required: ["none"] })) problems.push("data_collection_permissions must be required: none");
    if (gecko && "gecko_android" in gecko) problems.push("gecko_android waits for real-device approval");
    if (manifest.background?.service_worker) problems.push("Firefox uses background scripts, not a service worker");
  }
  const csp = JSON.stringify(manifest.content_security_policy || "");
  if (/https?:|unsafe-eval|unsafe-inline|wasm-unsafe-eval/.test(csp)) problems.push("the extension CSP may allow only packaged code");
  if (/localhost|127\.0\.0\.1/.test(JSON.stringify(manifest)) && !testMatches.length) problems.push("production manifests must not name localhost");
  return problems;
}

async function writeTree(dir, files) {
  for (const path of Object.keys(files).sort()) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), files[path]);
  }
}

// Empties and returns <outDir>/<name>, refusing a directory that holds the source.
async function freshDir(outDir, name) {
  const out = resolve(ROOT, outDir);
  const up = relative(out, ROOT);
  if (up === "" || (!up.startsWith("..") && !isAbsolute(up))) throw new Error(`Refusing to build into ${out}, which contains the source`);
  const dir = join(out, name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

const hashes = (files) => Object.fromEntries(Object.keys(files).sort().map((path) => [path, sha256(files[path])]));

// The files of one browser package: the entry's files, the licenses and manifest.json.
export async function extensionFiles(browser, { config, entry, testFixture }) {
  const testMatches = testFixture?.matches || [];
  for (const match of testMatches) if (!LOCAL_MATCH.test(match)) throw new Error(`Test fixture match ${match} must be http://127.0.0.1/* or http://localhost/*`);
  const files = {};
  for (const path of entry.files) {
    if (isAbsolute(path) || path.split("/").includes("..")) throw new Error(`Entry file ${path} must stay inside ${entry.root}`);
    files[path] = await readSource(`${entry.root}/${path}`);
  }
  for (const [path, hash] of Object.entries(entry.frozen)) {
    if (!files[path] || sha256(files[path]) !== hash) {
      throw new Error(`${entry.root}/${path} is frozen for this entry and has changed. The build never regenerates it.`);
    }
  }
  const notices = noticeProblems(entry);
  if (notices.length) throw new Error(`extension entry:\n  ${notices.join("\n  ")}`);
  for (const path of licenseFiles(entry)) {
    if (files[path]) throw new Error(`License file ${path} collides with an entry file`);
    files[path] = await readSource(path);
  }

  const manifest = await extensionManifest(browser, config);
  if (testMatches.length) for (const script of manifest.content_scripts) script.matches = [...script.matches, ...testMatches];
  const problems = manifestProblems(manifest, browser, config, { testMatches });
  const missing = manifestPaths(manifest).filter((path) => !files[path]);
  if (missing.length) problems.push(`the manifest names files the entry lacks: ${missing.join(", ")}`);
  if (problems.length) throw new Error(`${browser} manifest:\n  ${problems.join("\n  ")}`);
  files["manifest.json"] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  return { files, manifest };
}

async function buildExtension(browser, { outDir, releaseConfig, testFixture }) {
  const { files, manifest } = await extensionFiles(browser, { config: releaseConfig, entry: await loadEntry(releaseConfig), testFixture });
  // A test build never lands where a production package is expected.
  const dir = await freshDir(outDir, testFixture ? `${browser}-test` : browser);
  await writeTree(dir, files);
  return { target: browser, dir, files: hashes(files), manifest };
}

// The userscript builder named in release.config.json exports build(), which returns the script.
async function buildUserscript({ outDir, releaseConfig }) {
  const { builder, output } = releaseConfig.userscript;
  const { build: generate } = await import(pathToFileURL(join(ROOT, builder)).href);
  const files = { [output]: Buffer.from(await generate()) };
  const dir = await freshDir(outDir, "userscript");
  await writeTree(dir, files);
  return { target: "userscript", dir, files: hashes(files) };
}

// Shared build scopes. Each lists every package it bundles, so it builds all of its real
// prerequisites, and each package's owner; `inputs` are the data, font and notice files it also
// requires, copied into the output at the same paths. Without a scope, every shared package is
// built. A missing package, entry or input makes the scope not implemented yet rather than quietly
// smaller; an empty one fails. Every input must be a nonempty regular file, and JSON must hold data.
const ENGINE_PACKAGES = [["contracts", "C1"], ["format", "C2"], ["engine", "C2"]];
const PRIMER_INPUTS = [["vendor/primer/modes.json", "C3"], ["licenses/primer-primitives.txt", "C1"]];
// Each bundled family's one WOFF2 and its OFL notice. "system" ships no file.
export const FONT_INPUTS = FONT_IDS.filter((id) => id !== "system").flatMap((id) => [
  [`assets/fonts/${id}/${id}.woff2`, "C5"],
  [`assets/fonts/${id}/OFL.txt`, "C5"],
]);
export const SHARED_SCOPES = {
  engine: { packages: ENGINE_PACKAGES, inputs: [] },
  primer: { packages: [...ENGINE_PACKAGES, ["primer", "C3"]], inputs: PRIMER_INPUTS },
  preview: {
    packages: [...ENGINE_PACKAGES, ["primer", "C3"], ["appearance", "C5"], ["preview", "C5"]],
    inputs: [...PRIMER_INPUTS, ...FONT_INPUTS],
  },
};
const ALL_SHARED = {
  packages: [...SHARED_SCOPES.preview.packages, ["settings", "C4"], ["ui", "C6"]],
  inputs: SHARED_SCOPES.preview.inputs,
};

// Why a required input file is unusable, or null. "missing" means it does not exist yet.
export async function inputProblem(path, { root = ROOT } = {}) {
  const info = await stat(join(root, path)).catch(() => null);
  if (!info) return "missing";
  if (!info.isFile()) return "is not a regular file";
  if (!info.size) return "is empty";
  if (path.endsWith(".json")) {
    let value;
    try {
      value = JSON.parse(await readFile(join(root, path), "utf8"));
    } catch {
      return "is not valid JSON";
    }
    if (!value || typeof value !== "object" || !Object.keys(value).length) return "holds no data";
  }
  return null;
}

// The package.json "." export of packages/<name>, relative to the package, or null.
async function packageEntry(name, root) {
  const manifest = join(root, "packages", name, "package.json");
  if (!existsSync(manifest)) return null;
  const exported = JSON.parse(await readFile(manifest, "utf8")).exports?.["."];
  return (typeof exported === "string" ? exported : exported?.default) ?? null;
}

// Bundles packages/<name> for browsers, in root. A package's package.json "." export is its entry.
// Platform-neutral, so a package that reaches for Node built-ins fails here. The shared target
// rejects a bundle that comes out empty.
export async function bundlePackages(names, { root = ROOT } = {}) {
  const { build: esbuild } = await import("esbuild");
  const files = {};
  for (const name of names) {
    const entry = await packageEntry(name, root);
    if (!entry) throw new Error(`packages/${name}/package.json needs an "exports" "." entry`);
    const result = await esbuild({
      entryPoints: [`packages/${name}/${entry}`],
      absWorkingDir: root,
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: ["chrome120", "firefox140"],
      charset: "utf8",
      legalComments: "inline",
      write: false,
      logLevel: "silent",
    });
    files[`${name}.js`] = Buffer.from(result.outputFiles[0].contents);
  }
  return files;
}

// The missing and unusable prerequisites of a shared scope, in root: missing as [path, owner]
// pairs, broken as messages naming the owner.
export async function sharedPrerequisites(scope, { root = ROOT } = {}) {
  const { packages, inputs } = scope ? SHARED_SCOPES[scope] : ALL_SHARED;
  const missing = [];
  const broken = [];
  const require = async (path, owner) => {
    const problem = await inputProblem(path, { root });
    if (problem === "missing") missing.push([path, owner]);
    else if (problem) broken.push(`${path} (${owner}) ${problem}`);
  };
  for (const [name, owner] of packages) {
    const entry = await packageEntry(name, root);
    if (entry) await require(`packages/${name}/${entry.replace(/^\.\//, "")}`, owner);
    else missing.push([`packages/${name}`, owner]);
  }
  for (const [path, owner] of inputs) await require(path, owner);
  return { missing, broken };
}

async function buildShared(options) {
  return buildSharedFrom(ROOT, options);
}

// The shared target with root's packages and inputs, so tests can supply them.
export async function buildSharedFrom(root, { outDir, scope }) {
  if (scope !== undefined && !Object.hasOwn(SHARED_SCOPES, scope)) throw new Error(`Unknown shared scope ${scope}. Scopes: ${BUILD_SCOPES.join(", ")}`);
  const { packages, inputs } = scope ? SHARED_SCOPES[scope] : ALL_SHARED;
  const label = scope ? `shared --scope=${scope}` : "shared";
  const { missing, broken } = await sharedPrerequisites(scope, { root });
  if (missing.length) {
    const owners = [...new Set(missing.map(([, owner]) => owner))].join(", ");
    throw new NotImplementedError(label, owners, `needs ${missing.map(([path, owner]) => `${path} (${owner})`).join(", ")}`);
  }
  if (broken.length) throw new Error(`${label}:\n  ${broken.join("\n  ")}`);

  const files = await bundlePackages(packages.map(([name]) => name), { root });
  for (const [path] of inputs) files[path] = await readSource(path, root);
  const dir = await freshDir(outDir, "shared");
  await writeTree(dir, files);
  const written = await readTree(dir);
  const owner = Object.fromEntries([...packages.map(([name, by]) => [`${name}.js`, by]), ...inputs]);
  const empty = Object.keys(files).filter((path) => !written[path]?.length);
  if (empty.length) throw new Error(`${label} wrote empty output: ${empty.map((path) => `${path} (${owner[path]})`).join(", ")}`);
  return { target: "shared", scope: scope ?? null, dir, files: hashes(written) };
}

// The site is C7's: site/build.mjs exports build({ outDir, config }) and writes the static site
// into outDir, which this empties first. Until that export exists the target is not implemented.
const SITE_BUILDER = "site/build.mjs";
const SITE_ENTRY = "index.html";

async function buildSite({ outDir, releaseConfig }) {
  return buildSiteFrom(ROOT, { outDir, releaseConfig });
}

// The site target with root's site/build.mjs, so tests can supply a builder.
export async function buildSiteFrom(root, { outDir, releaseConfig }) {
  const path = join(root, SITE_BUILDER);
  if (!existsSync(path)) throw new NotImplementedError("site", "C7", `${SITE_BUILDER} does not exist`);
  const { build: buildSiteFiles } = await import(pathToFileURL(path).href);
  if (typeof buildSiteFiles !== "function") throw new NotImplementedError("site", "C7", `${SITE_BUILDER} has no build export`);
  const dir = await freshDir(outDir, "site");
  await buildSiteFiles({ outDir: dir, config: releaseConfig });
  const files = await readTree(dir);
  if (!Object.keys(files).length) throw new Error(`${SITE_BUILDER} (C7) wrote nothing to ${dir}`);
  // The entry page must be real; other files, such as .nojekyll, may be empty.
  if (!files[SITE_ENTRY]?.length) throw new Error(`${SITE_BUILDER} (C7) wrote no nonempty ${SITE_ENTRY} to ${dir}`);
  return { target: "site", dir, files: hashes(files) };
}

async function readTree(dir) {
  const files = {};
  const walk = async (at) => {
    for (const item of await readdir(at, { withFileTypes: true })) {
      const path = join(at, item.name);
      if (item.isDirectory()) await walk(path);
      else files[relative(dir, path).split("\\").join("/")] = await readFile(path);
    }
  };
  await walk(dir);
  return files;
}

const BUILDERS = {
  chrome: (options) => buildExtension("chrome", options),
  firefox: (options) => buildExtension("firefox", options),
  userscript: buildUserscript,
  shared: buildShared,
  site: buildSite,
};

/** @param {import("../packages/contracts/index.js").BuildOptions} options */
export async function build({ target, outDir = "dist", releaseConfig, scope, testFixture }) {
  if (!Object.hasOwn(BUILDERS, target)) throw new Error(`Unknown target ${target}. Targets: ${BUILD_TARGETS.join(", ")}`);
  if (scope !== undefined && target !== "shared") throw new Error(`--scope applies to the shared target, not ${target}`);
  return BUILDERS[target]({ outDir, releaseConfig: releaseConfig || (await loadReleaseConfig()), scope, testFixture });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { target: { type: "string", default: "all" }, out: { type: "string", default: "dist" }, scope: { type: "string" } } });
  const targets = values.target === "all" ? BUILD_TARGETS : values.target.split(",");
  if (values.scope && !targets.includes("shared")) throw new Error("--scope applies to the shared target");
  const releaseConfig = await loadReleaseConfig();
  const missing = [];
  for (const target of targets) {
    try {
      const result = await build({ target, outDir: values.out, releaseConfig, scope: target === "shared" ? values.scope : undefined });
      console.log(`built ${relative(process.cwd(), result.dir)}: ${Object.keys(result.files).length} files, tree ${treeHash(result.files).slice(0, 12)}`);
    } catch (error) {
      if (!(error instanceof NotImplementedError)) throw error;
      missing.push(error.message);
    }
  }
  if (missing.length) {
    console.error(`${missing.map((message) => `NOT IMPLEMENTED: ${message}`).join("\n")}\nThis build is incomplete.`);
    process.exit(2);
  }
}
