// Build-time captures of the shared preview, for first paint, pages without JavaScript and the
// gallery. site/src/scripts/capture.mjs mounts the same engine.mjs the site loads (C5 mountPreview,
// C3's Primer adapter and slot evidence, the viewer format/engine with the bundled CSS proofs) in
// Chromium, and each capture is a screenshot of that real styled frame, so a picture never shows
// anything the live preview would not. The manifest records each theme's source, seed and compiler
// hashes as the live preview reported them; tests compare them with the extension's resolver.
//
// For each bundled theme:
//   phone  the 358px narrow layout in the preview's compact phone composition, top PHONE.height
//          px, at 2x: the phone hero's first paint. It records whether the first pinned repository
//          and the graph's legend are inside the picture.
//   desk   the 896px wide layout, top DESK.height px, at 2x: the desktop hero's first paint
//   card   the narrow layout from the first pinned repository through the contribution graph box,
//          at 1.25x and lighter compression: gallery cards, which browsers fetch early
//   calm   the phone capture with Calm preferences: the Full/Calm comparison beside phone
// Captures are cached under site/.cache/previews by a hash of everything they depend on.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, esbuildPlugin } from "./modules.mjs";

export const CACHE_DIR = join(ROOT, "site/.cache/previews");
export const BASE = "/GitHub-Reskin/";
// The phone window's size (site.css): the compact composition through the graph's legend.
export const PHONE = Object.freeze({ width: 358, height: 372, scale: 2 });
export const DESK = Object.freeze({ width: 896, height: 640, scale: 2 });
export const CARD = Object.freeze({ width: 358, scale: 1.25, quality: 0.72 });
const QUALITY = 0.8;
const CAPTURE_VERSION = 4;

// Everything a capture depends on, hashed for the cache.
const INPUTS = [
  "themes", "packages/preview", "packages/appearance", "packages/engine", "packages/format", "packages/primer", "packages/contracts",
  "vendor/primer/modes.json", "assets/fonts", "extension/content/github", "site/src/engine.mjs", "site/src/catalog.mjs",
  "site/src/scripts/capture.mjs", "site/prerender.mjs", "site/modules.mjs", "package-lock.json",
];

async function files(path) {
  const info = await stat(join(ROOT, path)).catch(() => null);
  if (!info) return [];
  if (info.isFile()) return [path];
  const out = [];
  for (const item of (await readdir(join(ROOT, path), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.name.startsWith(".") || item.name === "node_modules") continue;
    out.push(...(await files(`${path}/${item.name}`)));
  }
  return out;
}

export async function inputHash() {
  const hash = createHash("sha256").update(`capture ${CAPTURE_VERSION}\n`);
  for (const path of INPUTS) for (const file of await files(path)) hash.update(`${file}\n`).update(await readFile(join(ROOT, file)));
  return hash.digest("hex");
}

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const item of await readdir(from, { withFileTypes: true })) {
    if (item.isDirectory()) await copyTree(join(from, item.name), join(to, item.name));
    else await copyFile(join(from, item.name), join(to, item.name));
  }
}

/**
 * Copies the files the live preview reads at run time into a site directory under its base:
 * the bundled fonts at assets/fonts/<id>/ and the fixture images at packages/preview/fixture/assets/,
 * the paths siteResources(base) resolves.
 */
export async function copyRuntimeFiles(dir) {
  await copyTree(join(ROOT, "assets/fonts"), join(dir, "assets/fonts"));
  await copyTree(join(ROOT, "packages/preview/fixture/assets"), join(dir, "packages/preview/fixture/assets"));
  // The fixture's own notices, for the credits page.
  await mkdir(join(dir, "licenses"), { recursive: true });
  for (const name of ["OFL-Chakra-Petch.txt", "OFL-JetBrains-Mono.txt"]) await copyFile(join(ROOT, "packages/preview/fixture", name), join(dir, "licenses", name));
}

/** Captures every bundled theme, or reuses the cache. Returns the manifest. */
export async function prerender({ log = () => {} } = {}) {
  const hash = await inputHash();
  const manifestPath = join(CACHE_DIR, "manifest.json");
  if (existsSync(manifestPath)) {
    const cached = JSON.parse(await readFile(manifestPath, "utf8"));
    const complete = cached.inputHash === hash && Object.values(cached.themes).every((t) => ["phone", "desk", "card", "calm"].every((k) => existsSync(join(CACHE_DIR, t[k].file))));
    if (complete) return cached;
  }
  const { CATALOG } = await import("./src/catalog.mjs");
  const { build } = await import("esbuild");
  const { chromium } = await import("@playwright/test");
  const { serve } = await import("../scripts/serve.mjs");

  await rm(CACHE_DIR, { recursive: true, force: true });
  const stage = join(CACHE_DIR, "stage");
  await mkdir(stage, { recursive: true });
  await build({
    entryPoints: [join(ROOT, "site/src/scripts/capture.mjs")],
    outfile: join(stage, "capture.js"),
    absWorkingDir: ROOT,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    define: { "import.meta.env.BASE_URL": JSON.stringify(BASE) },
    plugins: [esbuildPlugin()],
    logLevel: "silent",
  });
  await writeFile(join(stage, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#0c0f14}#stage{position:relative}</style><script type="module" src="./capture.js"></script></head><body><div id="stage"></div></body></html>`);
  await copyRuntimeFiles(stage);

  const server = await serve({ root: stage, host: "127.0.0.1", base: BASE.slice(0, -1) });
  const browser = await chromium.launch();
  const manifest = { inputHash: hash, captureVersion: CAPTURE_VERSION, phone: PHONE, desk: DESK, card: CARD, themes: {} };
  try {
    const encoder = await browser.newPage();
    const webp = async (png, quality = QUALITY) => {
      const data = await encoder.evaluate(async ({ b64, quality }) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const canvas = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        return { url: canvas.toDataURL("image/webp", quality), width: bitmap.width, height: bitmap.height };
      }, { b64: png.toString("base64"), quality });
      if (!data.url.startsWith("data:image/webp;")) throw new Error("This Chromium cannot encode WebP");
      return { bytes: Buffer.from(data.url.slice(data.url.indexOf(",") + 1), "base64"), width: data.width, height: data.height };
    };
    const pages = {};
    for (const [name, { width, scale }] of Object.entries({ narrow: { width: PHONE.width, scale: PHONE.scale }, wide: DESK, card: CARD })) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: scale });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(server.url);
      await page.waitForFunction(() => typeof window.reskinCapture === "function");
      pages[name] = { page, errors };
    }
    const shoot = async (name, options, clip, quality) => {
      const { page, errors } = pages[name];
      const info = await page.evaluate((o) => window.reskinCapture(o), options);
      if (errors.length) throw new Error(`Capture of ${options.slug} failed: ${errors.join("; ")}`);
      const region = clip(info);
      const png = await page.screenshot({ clip: { x: 0, y: region.top, width: options.width, height: region.bottom - region.top } });
      return { info, image: await webp(png, quality), css: { width: options.width, height: region.bottom - region.top } };
    };
    for (const theme of CATALOG) {
      const entry = {};
      const save = async (kind, shot, extra = {}) => {
        const file = `${theme.slug}-${kind}.webp`;
        await writeFile(join(CACHE_DIR, file), shot.image.bytes);
        entry[kind] = { file, width: shot.css.width, height: shot.css.height, bytes: shot.image.bytes.length, ...extra };
      };
      const top = (i) => ({ top: 0, bottom: Math.min(PHONE.height, i.height) });
      const shows = (shot) => ({ shows: Object.fromEntries(Object.entries(shot.info.ends).map(([part, end]) => [part, end !== null && end <= shot.css.height])) });
      const phone = await shoot("narrow", { slug: theme.slug, width: PHONE.width, compact: true }, top);
      await save("phone", phone, shows(phone));
      await save("desk", await shoot("wide", { slug: theme.slug, width: DESK.width }, (i) => ({ top: 0, bottom: Math.min(DESK.height, i.height) })));
      await save("card", await shoot("card", { slug: theme.slug, width: CARD.width }, (i) => i.card, CARD.quality));
      const calm = await shoot("narrow", { slug: theme.slug, width: PHONE.width, calm: true, compact: true }, top);
      await save("calm", calm, shows(calm));
      const { sourceHash, seedHash, fingerprint, policy } = phone.info;
      Object.assign(entry, { sourceHash, seedHash, fingerprint, policy });
      manifest.themes[theme.slug] = entry;
      log(`captured ${theme.slug}`);
    }
  } finally {
    await browser.close();
    await server.close();
    await rm(stage, { recursive: true, force: true });
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Copies the cached captures into dir/previews. */
export async function copyCaptures(dir, manifest) {
  await mkdir(join(dir, "previews"), { recursive: true });
  for (const theme of Object.values(manifest.themes)) for (const kind of ["phone", "desk", "card", "calm"]) await copyFile(join(CACHE_DIR, theme[kind].file), join(dir, "previews", theme[kind].file));
}
