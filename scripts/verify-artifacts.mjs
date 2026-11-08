// Checks what scripts/package.mjs wrote: checksums, ZIP layout and normalization, manifests,
// permissions, Gecko ID, licenses, the exact runtime file list, external resources, the
// userscript header and upstream notices, the source archive and build-info. Prints every
// problem and exits 1 on any.
// Run: node scripts/verify-artifacts.mjs [--dir artifacts], or check:artifacts through scripts/check.mjs.
import { realpathSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { unzipSync } from "fflate";
import { ROOT, extensionManifest, licenseFiles, licenseTargets, loadEntry, loadReleaseConfig, manifestPaths, manifestProblems, noticeProblems, readSource, sha256 } from "./build.mjs";
import { artifactName } from "./package.mjs";

const DOS_1980_01_01 = (0 << 9) | (1 << 5) | 1;
const FILE_644 = 0o100644;
// Paths and contents that never belong in a package.
const FORBIDDEN_PATH = /(^|\/)(node_modules|dist|artifacts|\.git)(\/|$)|(^|\/)\.env|\.(pem|key|p12|map)$|(^|\/)id_(rsa|ed25519)/;
const SECRET = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}|\bAKIA[0-9A-Z]{16}\b/;
// Ways a runtime file could load code or data from the network. A plain link a person clicks is allowed.
const REMOTE = [
  [/<(script|link|img|iframe|source|video|audio)\b[^>]*\b(src|href)\s*=\s*["']?(https?:)?\/\//i, "remote element resource"],
  [/@import|url\(\s*["']?(https?:)?\/\//i, "remote CSS resource"],
  [/\b(fetch|importScripts|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/, "network call"],
  [/\beval\s*\(|\bnew Function\s*\(/, "runtime code evaluation"],
];

// Runtime files that could load code or data from the network, as messages.
export function remoteResourceProblems(files) {
  const problems = [];
  for (const [path, data] of Object.entries(files)) {
    if (!/\.(js|html|css|json)$/.test(path)) continue;
    const text = Buffer.from(data).toString("utf8");
    for (const [pattern, what] of REMOTE) if (pattern.test(text)) problems.push(`${path} has a ${what}`);
  }
  return problems;
}

// The central directory of a ZIP: name, DOS date/time, Unix mode, and the order entries appear in.
export function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a ZIP file");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad central directory");
    const nameLength = view.getUint16(at + 28, true);
    const skip = nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      madeBy: view.getUint8(at + 5),
      time: view.getUint16(at + 12, true),
      date: view.getUint16(at + 14, true),
      mode: view.getUint32(at + 38, true) >>> 16,
    });
    at += 46 + skip;
  }
  return entries;
}

export async function verifyArtifacts(dir = "artifacts") {
  const out = resolve(ROOT, dir);
  const problems = [];
  let checks = 0;
  const fail = (message) => problems.push(message);
  // Every check counts, passing or not, so the run reports how many assertions it made.
  const expect = (ok, message) => {
    checks++;
    if (!ok) fail(message);
  };
  const config = await loadReleaseConfig();
  const entry = await loadEntry(config);
  const { version } = config;
  const read = async (name) => {
    try {
      return await readFile(join(out, name));
    } catch {
      fail(`${name} is missing`);
      return null;
    }
  };

  // Checksums cover every artifact, and nothing stale sits beside them.
  const sums = (await read("SHA256SUMS"))?.toString("utf8") ?? "";
  const listed = new Map(sums.trim().split("\n").filter(Boolean).map((line) => line.split(/ {2}/).reverse()));
  const expected = ["build-info.json", ...["amo-source", "chrome", "firefox", "userscript"].map((kind) => artifactName(version, kind))].sort();
  expect(JSON.stringify([...listed.keys()].sort()) === JSON.stringify(expected), `SHA256SUMS lists ${[...listed.keys()].join(", ")}, expected ${expected.join(", ")}`);
  for (const name of (await readdir(out)).filter((n) => /^github-reskin-/.test(n))) expect(expected.includes(name), `${name} is not part of release ${version}`);
  const bytes = {};
  for (const name of expected) {
    bytes[name] = await read(name);
    expect(!(bytes[name] && listed.get(name) !== sha256(bytes[name])), `${name} does not match SHA256SUMS`);
  }

  const contents = {};
  const zipped = (name) => {
    if (!bytes[name]) return null;
    const entries = zipEntries(bytes[name]);
    const names = entries.map((e) => e.name);
    expect(JSON.stringify(names) === JSON.stringify([...names].sort()), `${name}: entries are not sorted`);
    expect(new Set(names).size === names.length, `${name}: duplicate entries`);
    for (const e of entries) {
      expect(!(e.time !== 0 || e.date !== DOS_1980_01_01), `${name}: ${e.name} is not dated 1980-01-01 00:00`);
      expect(!(e.mode !== FILE_644 || e.madeBy !== 3), `${name}: ${e.name} is not a 644 Unix file`);
      expect(!(e.name.endsWith("/") || e.name.startsWith("/") || e.name.split("/").includes("..")), `${name}: bad path ${e.name}`);
      expect(!FORBIDDEN_PATH.test(e.name), `${name}: ${e.name} does not belong in a package`);
    }
    const files = unzipSync(bytes[name]);
    for (const [path, data] of Object.entries(files)) expect(!SECRET.test(Buffer.from(data).toString("latin1")), `${name}: ${path} looks like it contains a secret`);
    return (contents[name] = files);
  };

  // License files, checked-in bytes. Each must ship unchanged in both packages and the source archive.
  for (const problem of noticeProblems(entry)) fail(problem);
  const licenses = {};
  for (const path of licenseFiles(entry)) licenses[path] = sha256(await readSource(path));
  const licensesIn = (name, files) => {
    for (const [path, hash] of Object.entries(licenses)) {
      expect(files[path]?.length, `${name}: license file ${path} is missing`);
      if (files[path]?.length) expect(sha256(files[path]) === hash, `${name}: ${path} differs from the checked-in notice`);
    }
  };

  // Browser packages.
  const allowed = [...entry.files, ...Object.keys(licenses), "manifest.json"].sort();
  const manifests = {};
  for (const browser of ["chrome", "firefox"]) {
    const name = artifactName(version, browser);
    const files = zipped(name);
    if (!files) continue;
    if (!files["manifest.json"]) {
      fail(`${name}: no manifest.json at the root`);
      continue;
    }
    const manifest = (manifests[browser] = JSON.parse(Buffer.from(files["manifest.json"]).toString("utf8")));
    for (const problem of manifestProblems(manifest, browser, config)) fail(`${name}: ${problem}`);
    expect(JSON.stringify(manifest) === JSON.stringify(await extensionManifest(browser, config)), `${name}: manifest.json differs from extension/manifests`);
    for (const path of manifestPaths(manifest)) expect(files[path], `${name}: the manifest names ${path}, which is missing`);
    const paths = Object.keys(files).sort();
    expect(JSON.stringify(paths) === JSON.stringify(allowed), `${name}: files ${paths.join(", ")} differ from the entry allowlist ${allowed.join(", ")}`);
    licensesIn(name, files);
    for (const problem of remoteResourceProblems(files)) fail(`${name}: ${problem}`);
  }
  // The two packages hold the same files; only the manifest may differ.
  const [chrome, firefox] = ["chrome", "firefox"].map((b) => contents[artifactName(version, b)]);
  if (chrome && firefox) {
    for (const path of new Set([...Object.keys(chrome), ...Object.keys(firefox)])) {
      expect(!(path !== "manifest.json" && (!chrome[path] || !firefox[path] || sha256(chrome[path]) !== sha256(firefox[path]))), `${path} differs between the Chrome and Firefox packages`);
    }
    const keys = new Set([...Object.keys(manifests.chrome), ...Object.keys(manifests.firefox)]);
    for (const key of keys) {
      const differs = JSON.stringify(manifests.chrome[key]) !== JSON.stringify(manifests.firefox[key]);
      expect(!(differs && !["browser_specific_settings", "background"].includes(key)), `manifest key ${key} differs between browsers without a platform reason`);
    }
  }

  // Userscript. Its remote @icon/@updateURL metadata is checked by check:userscript (C8).
  const userscript = bytes[artifactName(version, "userscript")]?.toString("utf8");
  if (userscript) {
    const header = /^\/\/ ==UserScript==\n([\s\S]*?)\/\/ ==\/UserScript==\n/.exec(userscript)?.[1] ?? "";
    expect(header, "the userscript has no metadata block");
    expect(new RegExp(`^// @version +${version.replaceAll(".", "\\.")}$`, "m").test(header), `the userscript @version is not ${version}`);
    expect(!/^\/\/ @require/m.test(header), "the userscript must not @require remote code");
    // It carries the extension's frozen upstream material, so it carries each notice too.
    for (const notice of entry.notices) {
      expect(userscript.includes((await readSource(notice.file)).toString("utf8")), `the userscript lacks the ${notice.file} notice`);
    }
  }

  // Source archive: exact inputs for a reviewer rebuild, no generated output or secrets.
  const source = zipped(artifactName(version, "amo-source"));
  if (source) {
    const required = ["BUILDING.md", "LICENSE", "package.json", "package-lock.json", "release.config.json", ".node-version", "scripts/build.mjs", "scripts/package.mjs"];
    required.push(...["base.json", "chrome.json", "firefox.json", "entries.json"].map((f) => `extension/manifests/${f}`));
    required.push(...entry.files.map((f) => `${entry.root}/${f}`), config.userscript.builder);
    for (const path of required) expect(source[path], `the source archive lacks ${path}`);
    for (const [path, hash] of Object.entries(entry.frozen)) {
      const file = source[`${entry.root}/${path}`];
      expect(!(file && sha256(file) !== hash), `the source archive's ${entry.root}/${path} is not the frozen snapshot`);
    }
    licensesIn("the source archive", source);
  }

  // build-info agrees with the release and the files.
  const infoBytes = bytes["build-info.json"];
  if (infoBytes) {
    const info = JSON.parse(infoBytes.toString("utf8"));
    expect(info.version === version, `build-info version ${info.version} is not ${version}`);
    expect(info.extensionEntry === config.extension.entry, "build-info names a different extension entry");
    expect(
      info.toolchain?.node === config.toolchain.node && info.toolchain?.npm === config.toolchain.npm,
      `built with Node ${info.toolchain?.node} and npm ${info.toolchain?.npm}; the release toolchain is Node ${config.toolchain.node} and npm ${config.toolchain.npm}`,
    );
    for (const [name, { sha256: hash }] of Object.entries(info.artifacts || {})) expect(!(bytes[name] && sha256(bytes[name]) !== hash), `build-info's hash of ${name} is wrong`);
    const inventory = new Map((info.licenses || []).map((item) => [item.file, item]));
    for (const [path, hash] of Object.entries(licenses)) {
      const item = inventory.get(path);
      expect(item, `build-info's license inventory lacks ${path}`);
      if (item) expect(item.sha256 === hash && JSON.stringify(item.in) === JSON.stringify(licenseTargets(entry, path)), `build-info's inventory entry for ${path} is wrong`);
    }
    for (const path of inventory.keys()) expect(licenses[path], `build-info lists ${path}, which no package carries`);
  }

  // A release tag must name the release version.
  const tag = process.env.RELEASE_TAG || (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "");
  expect(!(tag && tag !== `v${version}`), `tag ${tag} does not match version ${version}`);

  return { problems, checks };
}

/**
 * check:artifacts through scripts/check.mjs. Takes --dir, relative to root.
 * @type {import("../packages/contracts/index.js").CheckRunner}
 */
export async function run({ args, root }) {
  const { values } = parseArgs({ args, options: { dir: { type: "string", default: "artifacts" } } });
  const { problems, checks } = await verifyArtifacts(resolve(root, values.dir));
  if (problems.length) console.error(`check:artifacts found ${problems.length} problem(s) in ${checks} checks:\n  ${problems.join("\n  ")}`);
  else console.log(`check:artifacts passed for ${values.dir}: ${checks} checks`);
  return { exitCode: problems.length ? 1 : 0, testCount: checks };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = (await run({ args: process.argv.slice(2), root: ROOT })).exitCode;
}
