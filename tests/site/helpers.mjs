// Shared helpers for the site tests. The built site comes from RESKIN_SITE_DIR (set by
// `npm run check:site`) or is built once into a temporary directory, so `node --test tests/site/`
// and `npm test` also work from a clean checkout.
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const BASE = "/GitHub-Reskin/";

let built = null;
/** The built site directory, and a cleanup function for a temporary build. */
export async function siteDir() {
  if (process.env.RESKIN_SITE_DIR && existsSync(join(process.env.RESKIN_SITE_DIR, "index.html"))) return { dir: process.env.RESKIN_SITE_DIR, cleanup: async () => {} };
  if (!built) {
    built = (async () => {
      const tmp = await mkdtemp(join(tmpdir(), "reskin-site-"));
      const { buildSiteFrom, loadReleaseConfig } = await import("../../scripts/build.mjs");
      const { dir } = await buildSiteFrom(ROOT, { outDir: tmp, releaseConfig: await loadReleaseConfig() });
      return { dir, cleanup: () => rm(tmp, { recursive: true, force: true }) };
    })();
  }
  return built;
}

/** Every file under dir as a relative POSIX path. */
export async function listFiles(dir) {
  const files = [];
  const walk = async (at) => {
    for (const item of await readdir(at, { withFileTypes: true })) {
      const path = join(at, item.name);
      if (item.isDirectory()) await walk(path);
      else files.push(relative(dir, path).split("\\").join("/"));
    }
  };
  await walk(dir);
  return files.sort();
}

export const read = (dir, path) => readFile(join(dir, path), "utf8");

/** Attribute values of href and src in HTML. */
export const links = (html) => [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
