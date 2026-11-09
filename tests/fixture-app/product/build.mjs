// Builds the product fixture app into <outDir>/fixture/product: the bundled renderer (app.js), the
// three pages, the bundled fonts and the preview's fixture images, at the paths the site resource
// adapter expects under base "/". Offline: esbuild and checked-in files only.
//
// The app imports "reskin:primer" and "reskin:github". When C3's packages/primer and
// extension/content/github are in the checkout they are bundled; otherwise the Primer double and
// an empty content adapter are. app.js records which one in window.reskinAdapters.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FONTS } from "../../../packages/appearance/registry.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PAGES = ["preview.html", "views.html", "adversarial.html"];

/** The C3 modules the app bundles from root, or the stand-ins when C3 is not there. */
export function adapterPaths(root) {
  const primer = join(root, "packages/primer/index.js");
  const github = join(root, "extension/content/github/index.js");
  return {
    primer: existsSync(primer) && existsSync(join(root, "vendor/primer/modes.json")) ? primer : join(HERE, "primer-double.js"),
    github: existsSync(github) ? github : join(HERE, "github-absent.js"),
  };
}

export async function buildFixtureApp({ root, outDir }) {
  const { build } = await import("esbuild");
  const adapters = adapterPaths(root);
  const dir = join(outDir, "fixture", "product");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await build({
    entryPoints: [join(HERE, "app.js")],
    outfile: join(dir, "app.js"),
    absWorkingDir: root,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome120", "firefox140"],
    charset: "utf8",
    logLevel: "silent",
    plugins: [{ name: "reskin-adapters", setup: (b) => b.onResolve({ filter: /^reskin:(primer|github)$/ }, (args) => ({ path: adapters[args.path.slice(7)] })) }],
  });
  for (const page of PAGES) await copyFile(join(HERE, page), join(dir, page));
  for (const font of FONTS) {
    await mkdir(join(dir, dirname(font.path)), { recursive: true });
    await copyFile(join(root, font.path), join(dir, font.path));
  }
  const assets = join(root, "packages/preview/fixture/assets");
  await mkdir(join(dir, "packages/preview/fixture/assets"), { recursive: true });
  for (const name of await readdir(assets)) await copyFile(join(assets, name), join(dir, "packages/preview/fixture/assets", name));
  return dir;
}
