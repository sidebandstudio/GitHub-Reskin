// Proves the packages are reproducible. Two fresh builds in temporary directories, with network
// access disabled and different time zones and locales, must write identical dist trees and
// artifact bytes. A third build from the extracted source archive alone, without git, must then
// reproduce the same browser packages and userscript.
// Run: node scripts/verify-repro.mjs
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { unzipSync } from "fflate";
import { withTempDir } from "../tests/helpers/tmp.mjs";
import { ROOT, loadReleaseConfig, sha256 } from "./build.mjs";
import { artifactName } from "./package.mjs";

const OFFLINE = pathToFileURL(join(ROOT, "tests/helpers/no-network.mjs")).href;

async function tree(dir) {
  const files = {};
  const walk = async (at) => {
    for (const item of await readdir(at, { withFileTypes: true })) {
      const path = join(at, item.name);
      if (item.isDirectory()) await walk(path);
      else files[relative(dir, path).split("\\").join("/")] = sha256(await readFile(path));
    }
  };
  await walk(dir);
  return files;
}

function differences(a, b) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter((path) => a[path] !== b[path]);
}

function packageIn(cwd, out, env, extra = []) {
  const script = join(cwd, "scripts/package.mjs");
  const args = ["--import", OFFLINE, script, "--out", join(out, "artifacts"), "--dist", join(out, "dist"), ...extra];
  const result = spawnSync(process.execPath, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Offline package in ${cwd} failed:\n${result.stdout}${result.stderr}`);
}

export async function verifyRepro() {
  const config = await loadReleaseConfig();
  const problems = [];
  const npm = /\bnpm\/(\S+)/.exec(process.env.npm_config_user_agent || "")?.[1];
  if (process.versions.node !== config.toolchain.node) problems.push(`Node ${process.versions.node} is not the pinned ${config.toolchain.node}`);
  if (npm && npm !== config.toolchain.npm) problems.push(`npm ${npm} is not the pinned ${config.toolchain.npm}`);
  if (problems.length) return { problems };

  return withTempDir(async (tmp) => {
    const [a, b, c] = ["a", "b", "c"].map((name) => join(tmp, name));
    packageIn(ROOT, a, { TZ: "UTC", LANG: "C", LC_ALL: "C" });
    packageIn(ROOT, b, { TZ: "Pacific/Chatham", LANG: "tr_TR.UTF-8", LC_ALL: "tr_TR.UTF-8" });
    const [treeA, treeB] = [await tree(a), await tree(b)];
    for (const path of differences(treeA, treeB)) problems.push(`${path} differs between two identical builds`);

    // Rebuild from the source archive as a reviewer would, with the same installed dependencies.
    const src = join(c, "src");
    const archive = unzipSync(await readFile(join(a, "artifacts", artifactName(config.version, "amo-source"))));
    for (const [path, bytes] of Object.entries(archive)) {
      await mkdir(dirname(join(src, path)), { recursive: true });
      await writeFile(join(src, path), bytes);
    }
    await symlink(join(ROOT, "node_modules"), join(src, "node_modules"), "junction");
    packageIn(src, join(c, "out"), { TZ: "America/St_Johns" }, ["--no-source"]);
    const rebuilt = await tree(join(c, "out", "artifacts"));
    for (const kind of ["chrome", "firefox", "userscript"]) {
      const name = artifactName(config.version, kind);
      if (rebuilt[name] !== treeA[`artifacts/${name}`]) problems.push(`${name} rebuilt from the source archive differs`);
    }
    const artifacts = Object.fromEntries(Object.entries(treeA).filter(([path]) => path.startsWith("artifacts/")).map(([path, hash]) => [path.slice(10), hash]));
    return { problems, files: Object.keys(treeA).length, artifacts };
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, files, artifacts } = await verifyRepro();
  if (problems.length) {
    console.error(`check:repro failed:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check:repro passed: two offline builds wrote the same ${files} files, and the source archive rebuilt the same packages.`);
  for (const [name, hash] of Object.entries(artifacts)) console.log(`  ${hash}  ${name}`);
}
