// Packages the runtime builds: a store ZIP per browser, the userscript, a reviewer source archive,
// SHA256SUMS and build-info.json. ZIP entries are sorted, dated 1980-01-01 00:00 and stored as
// regular 644 files, so the same inputs always give the same bytes on any system and time zone.
// Run: node scripts/package.mjs [--out artifacts] [--dist dist] [--no-source]
// --no-source skips the source archive, for rebuilding from an extracted source archive without git.
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { zipSync } from "fflate";
import { LICENSE_FILES, ROOT, build, extensionManifest, loadEntry, loadReleaseConfig, readSource, sha256, treeHash } from "./build.mjs";

const ZIP_FILE_MODE = (0o100644 << 16) >>> 0;
const UNIX = 3;

export function zip(files) {
  // Local time on purpose: ZIP stores local date fields, so this writes the same fields in any zone.
  const date = new Date(1980, 0, 1, 0, 0, 0);
  const entries = {};
  for (const path of Object.keys(files).sort()) {
    if (/^\d+$/.test(path)) throw new Error(`ZIP entry ${path} would be reordered`);
    entries[path] = [files[path], { level: 9, mtime: date, os: UNIX, attrs: ZIP_FILE_MODE }];
  }
  return Buffer.from(zipSync(entries));
}

export const artifactName = (version, kind) => (kind === "userscript" ? `github-reskin-${version}.user.js` : `github-reskin-${version}-${kind}.zip`);

const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};

const npmVersion = () => /\bnpm\/(\S+)/.exec(process.env.npm_config_user_agent || "")?.[1] ?? null;

// Paths of JSON values that differ between two manifests.
function differences(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const objects = [a, b].every((v) => v && typeof v === "object" && !Array.isArray(v));
  if (!objects) return [path || "/"];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((key) => differences(a[key], b[key], `${path}/${key}`));
}

// Instructions for reviewers, written into the source archive.
const buildingNotes = (config, entry) => `# Building GitHub Reskin ${config.version} from this source

This archive is the exact source of the submitted packages. Building it needs no account, credentials,
live GitHub data or AI service, and makes no network requests after dependency installation.

Toolchain: Node.js ${config.toolchain.node} and npm ${config.toolchain.npm}, on Linux, macOS or Windows.

    npm install --global npm@${config.toolchain.npm}
    npm ci
    node scripts/package.mjs --no-source

npm ci installs the exact dependency versions in package-lock.json from the npm registry. The package
step reads only the files in this archive. The outputs are:

    artifacts/${artifactName(config.version, "firefox")}   Firefox package (unsigned)
    artifacts/${artifactName(config.version, "chrome")}    Chrome package
    artifacts/${artifactName(config.version, "userscript")}         userscript
    artifacts/SHA256SUMS, artifacts/build-info.json

ZIP bytes are reproducible: compare them with sha256sum. The Firefox and Chrome packages contain the
same files. Their manifests differ only where the browsers require it: Firefox keeps
browser_specific_settings (Gecko ID ${config.extension.geckoId}, minimum version 140.0, no data
collection), and Chrome omits it.

The extension entry is "${config.extension.entry}": ${entry.description} The files are listed in
extension/manifests/entries.json and copied without transformation. extension/github-modes.js is a
frozen, checked-in snapshot of GitHub's mode colors; the build checks its hash and never regenerates it.
scripts/github-modes.mjs is a separate maintenance tool that fetches github.com, and no build step runs it.

Licenses: LICENSE covers GitHub Reskin. ${entry.notices.map((n) => `${n.file} is the ${n.license} notice for ${n.covers.map((p) => `${entry.root}/${p}`).join(", ")} (${n.upstream})`).join("; ")}. Both browser packages carry them at the same paths.
`;

// Every license file the packages carry, with what it covers and where it ships.
async function licenseInventory(entry) {
  const packages = ["chrome", "firefox", "amo-source"];
  const own = LICENSE_FILES.map((file) => ({ file, license: "MIT", covers: ["GitHub Reskin"], upstream: null }));
  const notices = entry.notices.map(({ file, license, covers, upstream }) => ({ file, license, covers: covers.map((path) => `${entry.root}/${path}`), upstream }));
  return Promise.all([...own, ...notices].map(async (item) => ({ ...item, sha256: sha256(await readSource(item.file)), in: packages })));
}

async function sourceFiles(config, entry) {
  const listed = git("ls-files", "-z", "--cached", "--others", "--exclude-standard");
  if (listed === null) throw new Error("The source archive is built from a git checkout. Pass --no-source to skip it.");
  const files = {};
  for (const path of listed.split("\0").filter((p) => p && existsSync(join(ROOT, p)))) files[path] = await readSource(path);
  if (files["BUILDING.md"]) throw new Error("BUILDING.md is generated into the source archive; a checked-in one would be replaced");
  files["BUILDING.md"] = Buffer.from(buildingNotes(config, entry));
  return files;
}

/** @param {Partial<import("../packages/contracts/index.js").PackageOptions> & {outDir?: string, distDir?: string, source?: boolean}} options */
export async function packageRelease({ outDir = "artifacts", distDir = "dist", source = true, commit, epoch } = {}) {
  const config = await loadReleaseConfig();
  const entry = await loadEntry(config);
  const { version } = config;
  const out = resolve(ROOT, outDir);
  await mkdir(out, { recursive: true });
  // Only what this script writes. Reports and videos from other steps stay.
  for (const name of await readdir(out)) {
    if (/^github-reskin-.*\.(zip|user\.js)$|^SHA256SUMS$|^build-info\.json$/.test(name)) await rm(join(out, name));
  }

  const built = {};
  for (const target of ["chrome", "firefox", "userscript"]) built[target] = await build({ target, outDir: distDir, releaseConfig: config });

  const artifacts = {};
  for (const browser of ["chrome", "firefox"]) {
    const files = {};
    for (const path of Object.keys(built[browser].files)) files[path] = await readFile(join(built[browser].dir, path));
    artifacts[artifactName(version, browser)] = zip(files);
  }
  artifacts[artifactName(version, "userscript")] = await readFile(join(built.userscript.dir, config.userscript.output));
  if (source) artifacts[artifactName(version, "amo-source")] = zip(await sourceFiles(config, entry));

  const head = commit ?? process.env.GITHUB_SHA ?? git("rev-parse", "HEAD")?.trim() ?? null;
  const dirty = git("status", "--porcelain");
  const sourceDateEpoch = epoch ?? (Number(process.env.SOURCE_DATE_EPOCH) || Number(git("log", "-1", "--format=%ct", "HEAD")) || null);
  const lock = await readSource("package-lock.json");
  const info = {
    name: config.name,
    version,
    commit: head,
    sourceDirty: dirty === null ? null : dirty.trim() !== "",
    sourceDateEpoch,
    toolchain: { node: process.versions.node, npm: npmVersion(), pinned: config.toolchain },
    extensionEntry: config.extension.entry,
    targets: Object.fromEntries(Object.entries(built).map(([target, result]) => [target, { files: Object.keys(result.files).length, tree: treeHash(result.files) }])),
    hashes: {
      releaseConfig: sha256(await readSource("release.config.json")),
      lockfile: sha256(lock),
      frozen: Object.fromEntries(Object.entries(entry.frozen).map(([path, hash]) => [`${entry.root}/${path}`, hash])),
      // Filled in when the shared catalog, schema and engine exist (C2).
      catalog: null,
      schema: null,
      engine: null,
    },
    manifestDifferences: differences(await extensionManifest("chrome", config), await extensionManifest("firefox", config)),
    licenses: await licenseInventory(entry),
    artifacts: Object.fromEntries(Object.keys(artifacts).sort().map((name) => [name, { bytes: artifacts[name].length, sha256: sha256(artifacts[name]) }])),
  };
  artifacts["build-info.json"] = Buffer.from(`${JSON.stringify(info, null, 2)}\n`);
  artifacts.SHA256SUMS = Buffer.from(
    Object.keys(artifacts)
      .sort()
      .map((name) => `${sha256(artifacts[name])}  ${name}\n`)
      .join(""),
  );
  for (const [name, bytes] of Object.entries(artifacts)) await writeFile(join(out, name), bytes);
  return { dir: out, info, artifacts: Object.keys(artifacts).sort() };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { out: { type: "string", default: "artifacts" }, dist: { type: "string", default: "dist" }, "no-source": { type: "boolean", default: false } },
  });
  const result = await packageRelease({ outDir: values.out, distDir: values.dist, source: !values["no-source"] });
  for (const name of result.artifacts) console.log(`wrote ${join(values.out, name)}`);
  if (result.info.toolchain.node !== result.info.toolchain.pinned.node) {
    console.warn(`Warning: built with Node ${result.info.toolchain.node}, not the pinned ${result.info.toolchain.pinned.node}. check:artifacts will reject these.`);
  }
}
