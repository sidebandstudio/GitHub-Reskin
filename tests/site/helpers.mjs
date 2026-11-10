// Shared helpers for the site tests. The built site comes from RESKIN_SITE_DIR (set by
// `npm run check:site`) or is built once into a temporary directory, so `node --test tests/site/`
// and `npm test` also work from a clean checkout.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
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
      const { dir } = await oneBuildAtATime(async () => buildSiteFrom(ROOT, { outDir: tmp, releaseConfig: await loadReleaseConfig() }));
      return { dir, cleanup: () => rm(tmp, { recursive: true, force: true }) };
    })();
  }
  return built;
}

// node --test runs each test file in its own process, so two files can build the site at once.
// Builds share the preview capture cache in site/.cache/previews, which a cold build deletes and
// rewrites, and Astro's <cwd>/.astro/.prerender, its fallback when outDir is outside the working
// directory. A lock directory makes them take turns. One left by a killed run clears after ten
// minutes.
async function oneBuildAtATime(build) {
  const lock = join(ROOT, "site/.cache/test-build.lock");
  await mkdir(join(ROOT, "site/.cache"), { recursive: true });
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const since = await stat(lock).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (since > 10 * 60 * 1000) await rm(lock, { recursive: true, force: true });
      else await new Promise((done) => setTimeout(done, 250));
    }
  }
  try {
    return await build();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
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
